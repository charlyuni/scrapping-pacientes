import { chromium } from 'playwright';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { COLOR_CODES, type ScrapeResult, type ScrapedRow } from './types.js';

const SOURCE_URL = 'https://monitorps.sardegnasalute.it/monitorps/MonitorServlet';

async function selectFacility(page: import('playwright').Page, asl: string, hospital: string): Promise<void> {
  const aslSelect = page.locator('select').filter({ has: page.locator('option', { hasText: asl }) }).first();
  await aslSelect.waitFor({ state: 'visible', timeout: 20_000 });
  await aslSelect.selectOption({ label: asl });

  const hospitalSelect = page.locator('select').filter({ has: page.locator('option', { hasText: hospital }) }).first();
  await hospitalSelect.waitFor({ state: 'visible', timeout: 20_000 });
  await hospitalSelect.selectOption({ label: hospital });
}

async function waitForTable(page: import('playwright').Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 20_000 });
  await page.waitForFunction(
    (expectedColors: readonly string[]) => {
      const table = Array.from(document.querySelectorAll('table')).find((tbl) => {
        const headerText = tbl.innerText.toUpperCase();
        return expectedColors.every((c) => headerText.includes(c));
      });

      if (!table) return false;

      const bodyRows = table.querySelectorAll('tbody tr');
      return bodyRows.length >= 5;
    },
    COLOR_CODES,
    { timeout: 20_000 }
  );
}

async function extractRows(page: import('playwright').Page): Promise<ScrapedRow[]> {
  const rows = await page.evaluate((colors) => {
    const table = Array.from(document.querySelectorAll('table')).find((tbl) => {
      const headerText = tbl.innerText.toUpperCase();
      return colors.every((c) => headerText.includes(c));
    });

    if (!table) {
      throw new Error('No se encontró la tabla con códigos de color esperados');
    }

    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const output: Array<{ metricName: string; cells: Record<string, string> }> = [];

    const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
    for (const row of bodyRows) {
      const cells = Array.from(row.querySelectorAll('th,td')).map((cell) => normalize(cell.textContent ?? ''));
      if (cells.length < 6) continue;

      const metricName = cells[0];
      const values = cells.slice(1, 6);
      if (!metricName) continue;

      output.push({
        metricName,
        cells: {
          ROSSO: values[0] ?? '-',
          ARANCIONE: values[1] ?? '-',
          AZZURRO: values[2] ?? '-',
          VERDE: values[3] ?? '-',
          BIANCO: values[4] ?? '-'
        }
      });
    }

    return output;
  }, COLOR_CODES);

  return rows as ScrapedRow[];
}

export async function scrapeMonitor(asl: string, hospital: string): Promise<ScrapeResult> {
  const browser = await chromium.launch({ headless: env.HEADLESS });

  try {
    const context = await browser.newContext({ timezoneId: env.TZ });
    const page = await context.newPage();
    await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await selectFacility(page, asl, hospital);
    await waitForTable(page);

    const rows = await extractRows(page);
    const rawHtml = env.SAVE_RAW_HTML ? await page.content() : undefined;

    logger.info({ rows: rows.length, asl, hospital }, 'Tabla scrapeada correctamente');

    return {
      capturedAt: new Date(),
      sourceUrl: SOURCE_URL,
      rawHtml,
      rows
    };
  } finally {
    await browser.close();
  }
}
