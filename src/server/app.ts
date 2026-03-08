import express from 'express';
import { prisma } from '../db/client.js';
import { logger } from '../utils/logger.js';

const DEFAULT_ASL = 'ASL Nuoro';
const DEFAULT_HOSPITAL = 'OSPEDALE SAN FRANCESCO';

type SnapshotWithIncludedMetrics = NonNullable<Awaited<ReturnType<typeof prisma.snapshot.findFirst<{ include: ReturnType<typeof includeSnapshotQuery> }>>>>;

function includeSnapshotQuery() {
  return {
    metricRows: {
      include: {
        cells: true
      }
    }
  } as const;
}

function getFacilityQuery(req: express.Request) {
  return {
    asl: String(req.query.asl || DEFAULT_ASL),
    hospital: String(req.query.hospital || DEFAULT_HOSPITAL)
  };
}

function buildCellMap(snapshot: SnapshotWithIncludedMetrics) {
  const map = new Map<string, { valueString: string; valueNumber: number | null; valueMinutes: number | null }>();

  for (const row of snapshot.metricRows) {
    for (const cell of row.cells) {
      map.set(`${row.metricName}::${cell.colorCode}`, {
        valueString: cell.valueString,
        valueNumber: cell.valueNumber,
        valueMinutes: cell.valueMinutes
      });
    }
  }

  return map;
}

function parseHours(value: unknown, fallback: number, max = 24 * 14) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

type AsyncRequestHandler = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => Promise<unknown>;

function asyncHandler(handler: AsyncRequestHandler): express.RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

class QueryTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Database query timed out after ${timeoutMs}ms`);
  }
}

async function withQueryTimeout<T>(query: Promise<T>, timeoutMs = 10_000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new QueryTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([query, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function createApp() {
  const app = express();

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/health', asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', time: new Date().toISOString() });
  }));

  app.get('/latest', asyncHandler(async (req, res) => {
    const { asl, hospital } = getFacilityQuery(req);

    const snapshot = await prisma.snapshot.findFirst({
      where: {
        facility: {
          asl,
          hospital
        }
      },
      orderBy: { capturedAt: 'desc' },
      include: includeSnapshotQuery()
    });

    if (!snapshot) {
      res.status(404).json({ error: 'No snapshots found' });
      return;
    }

    res.json(snapshot);
  }));

  app.get('/snapshots', asyncHandler(async (req, res) => {
    const { asl, hospital } = getFacilityQuery(req);
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;

    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      res.status(400).json({ error: 'Invalid from/to date format' });
      return;
    }

    const snapshots = await prisma.snapshot.findMany({
      where: {
        facility: {
          asl,
          hospital
        },
        capturedAt: {
          gte: from,
          lte: to
        }
      },
      orderBy: { capturedAt: 'desc' },
      include: includeSnapshotQuery()
    });

    res.json(snapshots);
  }));

  app.get('/stats/summary', asyncHandler(async (req, res) => {
    const { asl, hospital } = getFacilityQuery(req);
    const latestTwo = await withQueryTimeout(prisma.snapshot.findMany({
      where: {
        facility: {
          asl,
          hospital
        }
      },
      orderBy: { capturedAt: 'desc' },
      take: 2,
      include: includeSnapshotQuery()
    }));

    if (!latestTwo[0]) {
      res.status(404).json({ error: 'No snapshots found' });
      return;
    }

    const latest = latestTwo[0];
    const previous = latestTwo[1] ?? null;
    const latestMap = buildCellMap(latest);
    const previousMap = previous ? buildCellMap(previous) : new Map();

    const cards = Array.from(latestMap.entries()).map(([key, current]) => {
      const [metricName, colorCode] = key.split('::');
      const before = previousMap.get(key);
      const deltaNumber =
        typeof current.valueNumber === 'number' && typeof before?.valueNumber === 'number'
          ? current.valueNumber - before.valueNumber
          : null;
      const deltaMinutes =
        typeof current.valueMinutes === 'number' && typeof before?.valueMinutes === 'number'
          ? current.valueMinutes - before.valueMinutes
          : null;

      return {
        metricName,
        colorCode,
        current,
        previous: before ?? null,
        deltaNumber,
        deltaMinutes
      };
    });

    const summary = {
      facility: { asl, hospital },
      latestCapturedAt: latest.capturedAt,
      previousCapturedAt: previous?.capturedAt ?? null,
      cards
    };

    // Backwards-compatible envelope for clients that still read `payload`.
    res.json({
      ...summary,
      payload: summary
    });
  }));

  app.get('/stats/trends', asyncHandler(async (req, res) => {
    const { asl, hospital } = getFacilityQuery(req);
    const hours = parseHours(req.query.hours, 24, 24 * 30);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const snapshots = await withQueryTimeout(prisma.snapshot.findMany({
      where: {
        facility: {
          asl,
          hospital
        },
        capturedAt: {
          gte: since
        }
      },
      orderBy: { capturedAt: 'asc' },
      include: includeSnapshotQuery()
    }));

    const seriesMap = new Map<string, { metricName: string; colorCode: string; points: Array<{ capturedAt: Date; valueNumber: number | null; valueMinutes: number | null; valueString: string }> }>();

    for (const snapshot of snapshots) {
      for (const row of snapshot.metricRows) {
        for (const cell of row.cells) {
          const key = `${row.metricName}::${cell.colorCode}`;
          if (!seriesMap.has(key)) {
            seriesMap.set(key, {
              metricName: row.metricName,
              colorCode: cell.colorCode,
              points: []
            });
          }
          seriesMap.get(key)?.points.push({
            capturedAt: snapshot.capturedAt,
            valueNumber: cell.valueNumber,
            valueMinutes: cell.valueMinutes,
            valueString: cell.valueString
          });
        }
      }
    }

    res.json({
      facility: { asl, hospital },
      hours,
      snapshots: snapshots.length,
      series: Array.from(seriesMap.values())
    });
  }));

  app.get('/stats/distribution', asyncHandler(async (req, res) => {
    const { asl, hospital } = getFacilityQuery(req);
    const hours = parseHours(req.query.hours, 24 * 7, 24 * 24);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const snapshots = await withQueryTimeout(prisma.snapshot.findMany({
      where: {
        facility: {
          asl,
          hospital
        },
        capturedAt: {
          gte: since
        }
      },
      orderBy: { capturedAt: 'asc' },
      include: includeSnapshotQuery()
    }));

    const aggMap = new Map<string, { metricName: string; colorCode: string; samples: number; sumNumber: number; countNumber: number; sumMinutes: number; countMinutes: number }>();

    for (const snapshot of snapshots) {
      for (const row of snapshot.metricRows) {
        for (const cell of row.cells) {
          const key = `${row.metricName}::${cell.colorCode}`;
          if (!aggMap.has(key)) {
            aggMap.set(key, {
              metricName: row.metricName,
              colorCode: cell.colorCode,
              samples: 0,
              sumNumber: 0,
              countNumber: 0,
              sumMinutes: 0,
              countMinutes: 0
            });
          }
          const agg = aggMap.get(key);
          if (!agg) continue;
          agg.samples += 1;
          if (typeof cell.valueNumber === 'number') {
            agg.sumNumber += cell.valueNumber;
            agg.countNumber += 1;
          }
          if (typeof cell.valueMinutes === 'number') {
            agg.sumMinutes += cell.valueMinutes;
            agg.countMinutes += 1;
          }
        }
      }
    }

    res.json({
      facility: { asl, hospital },
      hours,
      snapshots: snapshots.length,
      distribution: Array.from(aggMap.values()).map((agg) => ({
        ...agg,
        avgNumber: agg.countNumber ? agg.sumNumber / agg.countNumber : null,
        avgMinutes: agg.countMinutes ? agg.sumMinutes / agg.countMinutes : null
      }))
    });
  }));

  app.get('/dashboard', asyncHandler(async (_req, res) => {
    const snapshot = await prisma.snapshot.findFirst({
      orderBy: { capturedAt: 'desc' },
      include: includeSnapshotQuery()
    });

    if (!snapshot) {
      res.send('<h1>No hay snapshots aún</h1>');
      return;
    }

    const rowsHtml = snapshot.metricRows
      .map((row: (typeof snapshot.metricRows)[number]) => {
        const byColor = Object.fromEntries(
          row.cells.map((cell: (typeof row.cells)[number]) => [cell.colorCode, cell.valueString])
        );
        return `<tr><td>${row.metricName}</td><td>${byColor.ROSSO ?? '-'}</td><td>${byColor.ARANCIONE ?? '-'}</td><td>${byColor.AZZURRO ?? '-'}</td><td>${byColor.VERDE ?? '-'}</td><td>${byColor.BIANCO ?? '-'}</td></tr>`;
      })
      .join('');

    res.send(`<!doctype html>
<html><head><meta charset="utf-8" /><title>Dashboard MonitorPS</title></head>
<body>
  <h1>Último snapshot</h1>
  <p>capturedAt: ${snapshot.capturedAt.toISOString()}</p>
  <table border="1" cellpadding="6" cellspacing="0">
    <thead><tr><th>Métrica</th><th>ROSSO</th><th>ARANCIONE</th><th>AZZURRO</th><th>VERDE</th><th>BIANCO</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body></html>`);
  }));

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof QueryTimeoutError) {
      res.status(504).json({
        error: 'Database timeout',
        message: 'The database took too long to answer. Please retry in a few seconds.'
      });
      return;
    }

    logger.error({ err }, 'Unhandled server error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
