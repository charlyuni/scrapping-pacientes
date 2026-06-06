import { TARGET_ASL, TARGET_HOSPITAL } from './config/target.js';
import { prisma } from './db/client.js';
import { runScrapeWithRetry } from './scraper/snapshotService.js';
import { logger } from './utils/logger.js';

async function main() {
  await runScrapeWithRetry(TARGET_ASL, TARGET_HOSPITAL);
  logger.info({ asl: TARGET_ASL, hospital: TARGET_HOSPITAL }, 'Scrape único finalizado');
}

main()
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'Fatal error running one-off scrape');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
