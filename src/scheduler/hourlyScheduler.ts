import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { runScrapeWithRetry } from '../scraper/snapshotService.js';

export function startScheduler(asl: string, hospital: string): void {
  const interval = env.SCRAPE_INTERVAL_MINUTES;
  const cronExpr = `*/${interval} * * * *`;

  logger.info({ cronExpr, tz: env.TZ, asl, hospital }, 'Iniciando scheduler');

  cron.schedule(
    cronExpr,
    async () => {
      logger.info('Ejecutando scrape programado');
      await runScrapeWithRetry(asl, hospital);
    },
    { timezone: env.TZ }
  );
}
