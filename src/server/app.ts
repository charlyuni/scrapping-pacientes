import express from 'express';
import { prisma } from '../db/client.js';
import { logger } from '../utils/logger.js';

function includeSnapshotQuery() {
  return {
    metricRows: {
      include: {
        cells: true
      }
    }
  } as const;
}

export function createApp() {
  const app = express();

  app.get('/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.get('/latest', async (req, res) => {
    const asl = String(req.query.asl || 'ASL Nuoro');
    const hospital = String(req.query.hospital || 'OSPEDALE SAN FRANCESCO');

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
  });

  app.get('/snapshots', async (req, res) => {
    const asl = String(req.query.asl || 'ASL Nuoro');
    const hospital = String(req.query.hospital || 'OSPEDALE SAN FRANCESCO');
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
  });

  app.get('/dashboard', async (_req, res) => {
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
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'Unhandled server error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
