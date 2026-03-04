import { env } from './config/env.js';
import { prisma } from './db/client.js';
import { runScrapeWithRetry } from './scraper/snapshotService.js';
import { startScheduler } from './scheduler/hourlyScheduler.js';
import { createApp } from './server/app.js';
import { logger } from './utils/logger.js';

const TARGET_ASL = 'ASL Nuoro';
const TARGET_HOSPITAL = 'OSPEDALE SAN FRANCESCO';

async function main() {
  const app = createApp();

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'API server listening');
  });

  await runScrapeWithRetry(TARGET_ASL, TARGET_HOSPITAL);
  startScheduler(TARGET_ASL, TARGET_HOSPITAL);
}

main().catch(async (error) => {
  logger.fatal({ err: error }, 'Fatal error on startup');
  await prisma.$disconnect();
  process.exit(1);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT recibido, cerrando recursos');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM recibido, cerrando recursos');
  await prisma.$disconnect();
  process.exit(0);
});
