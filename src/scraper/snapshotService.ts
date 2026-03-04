import { prisma } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { parseIntegerValue, parseMinutesValue, floorToHourUTC } from './parsers.js';
import { scrapeMonitor } from './monitorScraper.js';

export async function runScrapeWithRetry(asl: string, hospital: string): Promise<void> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runScrapeAndPersist(asl, hospital);
      return;
    } catch (error) {
      logger.error({ err: error, attempt, maxAttempts }, 'Falló scraping');
      if (attempt === maxAttempts) {
        logger.error('Se agotaron los reintentos de scraping');
        return;
      }

      const backoffMs = attempt * 2_000;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

export async function runScrapeAndPersist(asl: string, hospital: string): Promise<void> {
  const result = await scrapeMonitor(asl, hospital);
  const hourBucket = floorToHourUTC(result.capturedAt);

  const facility = await prisma.facility.upsert({
    where: { asl_hospital: { asl, hospital } },
    update: {},
    create: { asl, hospital }
  });

  const existing = await prisma.snapshot.findUnique({
    where: {
      facilityId_hourBucket: {
        facilityId: facility.id,
        hourBucket
      }
    }
  });

  if (existing) {
    logger.info({ snapshotId: existing.id, hourBucket }, 'Snapshot de esa hora ya existe, se omite inserción');
    return;
  }

  await prisma.snapshot.create({
    data: {
      facilityId: facility.id,
      capturedAt: result.capturedAt,
      hourBucket,
      rawHtml: result.rawHtml,
      sourceUrl: result.sourceUrl,
      metricRows: {
        create: result.rows.map((row) => ({
          metricName: row.metricName,
          cells: {
            create: Object.entries(row.cells).map(([colorCode, valueString]) => ({
              colorCode,
              valueString,
              valueNumber: parseIntegerValue(valueString),
              valueMinutes: parseMinutesValue(valueString)
            }))
          }
        }))
      }
    }
  });

  logger.info({ capturedAt: result.capturedAt.toISOString(), rows: result.rows.length }, 'Snapshot guardado');
}
