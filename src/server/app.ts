import express from 'express';
import { prisma } from '../db/client.js';
import { logger } from '../utils/logger.js';

const DEFAULT_ASL = 'ASL Nuoro';
const DEFAULT_HOSPITAL = 'OSPEDALE SAN FRANCESCO';
const WAITING_METRIC_NAME = 'Pazienti in attesa di visita';

const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

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

function parseDayType(value: unknown): 'ALL' | 'WEEKDAY' | 'WEEKEND' {
  const parsed = String(value ?? 'ALL').toUpperCase();
  if (parsed === 'WEEKDAY' || parsed === 'WEEKEND') {
    return parsed;
  }
  return 'ALL';
}

function parseWeekdays(value: unknown): number[] | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const uniqueDays = new Set(
    value
      .split(',')
      .map((day) => Number(day.trim()))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  );

  if (uniqueDays.size === 0) {
    return null;
  }

  return Array.from(uniqueDays).sort((a, b) => a - b);
}

function isWeekend(day: number) {
  return day === 0 || day === 6;
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

function getErrorLogPayload(err: unknown) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack
    };
  }

  return {
    message: String(err)
  };
}

class QueryTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Database query timed out after ${timeoutMs}ms`);
  }
}

async function withQueryTimeout<T>(query: Promise<T>, timeoutMs = 10_000): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new QueryTimeoutError(timeoutMs));
    }, timeoutMs);

    query
      .then((result) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error: unknown) => {
        if (timedOut) {
          logger.warn({ error: getErrorLogPayload(error) }, 'Query failed after timeout');
          return;
        }
        clearTimeout(timeoutId);
        reject(error);
      });
  });
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

  app.get('/stats/waiting-patients', asyncHandler(async (req, res) => {
    const { asl, hospital } = getFacilityQuery(req);
    const hours = parseHours(req.query.hours, 24 * 14, 24 * 90);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const dayType = parseDayType(req.query.dayType);
    const weekdays = parseWeekdays(req.query.weekdays);
    const colorCode = typeof req.query.colorCode === 'string' ? req.query.colorCode.toUpperCase() : 'ALL';

    const snapshots = await withQueryTimeout(prisma.snapshot.findMany({
      where: {
        facility: { asl, hospital },
        capturedAt: { gte: since },
        metricRows: {
          some: {
            metricName: {
              equals: WAITING_METRIC_NAME,
              mode: 'insensitive'
            }
          }
        }
      },
      orderBy: { capturedAt: 'asc' },
      include: {
        metricRows: {
          where: {
            metricName: {
              equals: WAITING_METRIC_NAME,
              mode: 'insensitive'
            }
          },
          include: { cells: true }
        }
      }
    }));

    const rawSeries = snapshots
      .map((snapshot) => {
        const waitingRow = snapshot.metricRows[0];
        if (!waitingRow) return null;
        const day = snapshot.capturedAt.getDay();
        const cells = colorCode === 'ALL'
          ? waitingRow.cells
          : waitingRow.cells.filter((cell) => cell.colorCode.toUpperCase() === colorCode);

        const values = cells
          .map((cell) => cell.valueNumber)
          .filter((value): value is number => typeof value === 'number');

        if (values.length === 0) return null;

        return {
          capturedAt: snapshot.capturedAt,
          day,
          isWeekend: isWeekend(day),
          totalWaiting: values.reduce((acc, value) => acc + value, 0),
          byColor: waitingRow.cells.reduce<Record<string, number>>((acc, cell) => {
            if (typeof cell.valueNumber === 'number') {
              acc[cell.colorCode] = (acc[cell.colorCode] ?? 0) + cell.valueNumber;
            }
            return acc;
          }, {})
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    const filteredSeries = rawSeries.filter((entry) => {
      if (dayType === 'WEEKDAY' && entry.isWeekend) return false;
      if (dayType === 'WEEKEND' && !entry.isWeekend) return false;
      if (weekdays && !weekdays.includes(entry.day)) return false;
      return true;
    });

    const weekdayStats = Array.from({ length: 7 }, (_, weekday) => {
      const samples = rawSeries.filter((entry) => entry.day === weekday).map((entry) => entry.totalWaiting);
      const avgWaiting = samples.length ? samples.reduce((acc, value) => acc + value, 0) / samples.length : null;

      return {
        weekday,
        weekdayLabel: WEEKDAY_LABELS[weekday],
        samples: samples.length,
        avgWaiting,
        peakWaiting: samples.length ? Math.max(...samples) : null
      };
    });

    const weekdayOnlyValues = rawSeries.filter((entry) => !entry.isWeekend).map((entry) => entry.totalWaiting);
    const weekendValues = rawSeries.filter((entry) => entry.isWeekend).map((entry) => entry.totalWaiting);

    const avg = (values: number[]) => values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : null;

    const latest = filteredSeries.at(-1) ?? null;
    const previous = filteredSeries.length > 1 ? filteredSeries.at(-2) ?? null : null;

    res.json({
      facility: { asl, hospital },
      metricName: WAITING_METRIC_NAME,
      filters: {
        hours,
        dayType,
        weekdays,
        colorCode
      },
      latest: latest
        ? {
            capturedAt: latest.capturedAt,
            totalWaiting: latest.totalWaiting,
            deltaVsPrevious: previous ? latest.totalWaiting - previous.totalWaiting : null,
            byColor: latest.byColor
          }
        : null,
      snapshotsInWindow: rawSeries.length,
      snapshotsAfterFilters: filteredSeries.length,
      series: filteredSeries.map((entry) => ({
        capturedAt: entry.capturedAt,
        totalWaiting: entry.totalWaiting,
        weekday: entry.day,
        weekdayLabel: WEEKDAY_LABELS[entry.day],
        dayType: entry.isWeekend ? 'WEEKEND' : 'WEEKDAY'
      })),
      dayTypeStats: {
        weekday: {
          samples: weekdayOnlyValues.length,
          avgWaiting: avg(weekdayOnlyValues),
          peakWaiting: weekdayOnlyValues.length ? Math.max(...weekdayOnlyValues) : null
        },
        weekend: {
          samples: weekendValues.length,
          avgWaiting: avg(weekendValues),
          peakWaiting: weekendValues.length ? Math.max(...weekendValues) : null
        }
      },
      weekdayStats,
      topPeakDays: weekdayStats
        .filter((item) => item.peakWaiting !== null)
        .sort((a, b) => (b.peakWaiting ?? 0) - (a.peakWaiting ?? 0))
        .slice(0, 3)
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
    const errorMessage = err instanceof Error ? err.message : '';

    if (err instanceof QueryTimeoutError) {
      res.status(504).json({
        error: 'Database timeout',
        message: 'The database took too long to answer. Please retry in a few seconds.'
      });
      return;
    }

    if (errorMessage.includes('Environment variable not found: DATABASE_URL')) {
      res.status(500).json({
        error: 'Server misconfigured',
        message: 'DATABASE_URL is missing in the deployment environment.'
      });
      return;
    }

    if (errorMessage.includes("Can't reach database server")) {
      res.status(503).json({
        error: 'Database unavailable',
        message: 'The API could not connect to PostgreSQL. Check DATABASE_URL/DIRECT_URL and provider network rules.'
      });
      return;
    }

    logger.error({ error: getErrorLogPayload(err) }, 'Unhandled server error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
