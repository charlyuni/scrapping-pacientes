export const COLOR_CODES = ['ROSSO', 'ARANCIONE', 'AZZURRO', 'VERDE', 'BIANCO'] as const;

export type ColorCode = (typeof COLOR_CODES)[number];

export interface ScrapedRow {
  metricName: string;
  cells: Record<ColorCode, string>;
}

export interface ScrapeResult {
  capturedAt: Date;
  sourceUrl: string;
  rawHtml?: string;
  rows: ScrapedRow[];
}
