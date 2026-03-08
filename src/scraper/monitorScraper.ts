import { chromium } from 'playwright';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { COLOR_CODES, type ScrapeResult, type ScrapedRow } from './types.js';

const SOURCE_URL = 'https://monitorps.sardegnasalute.it/monitorps/MonitorServlet';

type FrameContext = import('playwright').Frame | import('playwright').Page;

function getContexts(page: import('playwright').Page): FrameContext[] {
  return [page, ...page.frames()];
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

async function findMatchingSelect(
  context: FrameContext,
  expectedOptionText: string
): Promise<import('playwright').Locator | null> {
  const target = normalizeText(expectedOptionText);
  const selects = context.locator('select');
  const selectCount = await selects.count();

  for (let index = 0; index < selectCount; index += 1) {
    const select = selects.nth(index);
    const options = await select.locator('option').allTextContents();
    const hasExpectedOption = options.some((optionText) => normalizeText(optionText).includes(target));

    if (hasExpectedOption) {
      return select;
    }
  }

  return null;
}

async function selectOptionByLabelIncludes(
  select: import('playwright').Locator,
  expectedOptionText: string
): Promise<void> {
  const target = normalizeText(expectedOptionText);
  const options = await select.locator('option').evaluateAll((nodes) =>
    nodes.map((option) => ({
      value: (option as HTMLOptionElement).value,
      label: (option as HTMLOptionElement).label,
      text: option.textContent ?? ''
    }))
  );

  const match = options.find((option) => {
    const candidate = option.label || option.text;
    return normalizeText(candidate).includes(target);
  });

  if (!match) {
    throw new Error(`No se encontró opción '${expectedOptionText}' en el select`);
  }

  await select.selectOption({ value: match.value });
}

async function selectFacility(page: import('playwright').Page, asl: string, hospital: string): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 });
  await page.waitForSelector('select, table', { timeout: 20_000 });

  let contexts = getContexts(page);

  let aslSelect: import('playwright').Locator | null = null;
  for (const context of contexts) {
    aslSelect = await findMatchingSelect(context, asl);
    if (aslSelect) break;
  }

  if (!aslSelect) {
    const debug = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select')).map((select) =>
        Array.from(select.querySelectorAll('option')).map((option) => option.textContent?.trim() ?? '')
      );

      return {
        title: document.title,
        url: location.href,
        selectCount: selects.length,
        optionsPreview: selects.slice(0, 3)
      };
    });

    const hasAnyTable = (await page.locator('table').count()) > 0;
    if (hasAnyTable) {
      logger.warn(
        { asl, hospital, debug },
        "No se encontró select para ASL; se intentará continuar con el contenido ya precargado"
      );
      return;
    }

    throw new Error(`No se encontró select para ASL '${asl}'. Debug: ${JSON.stringify(debug)}`);
  }

  await aslSelect.waitFor({ state: 'visible', timeout: 20_000 });
  await selectOptionByLabelIncludes(aslSelect, asl);

  await page.waitForLoadState('networkidle', { timeout: 20_000 });
  contexts = getContexts(page);

  let hospitalSelect: import('playwright').Locator | null = null;
  for (const context of contexts) {
    hospitalSelect = await findMatchingSelect(context, hospital);
    if (hospitalSelect) break;
  }

  if (!hospitalSelect) {
    throw new Error(`No se encontró select para hospital '${hospital}' después de seleccionar ASL '${asl}'`);
  }

  await hospitalSelect.waitFor({ state: 'visible', timeout: 20_000 });
  await selectOptionByLabelIncludes(hospitalSelect, hospital);
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
