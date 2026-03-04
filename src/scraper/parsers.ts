export function parseIntegerValue(value: string): number | null {
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  return null;
}

/**
 * Converts time strings to minutes.
 * Parsing rule used:
 * - If format is H:MM, convert as hours + minutes (e.g. 1:22 => 82 minutes).
 * - If format is M:SS, convert as minutes + seconds/60 when second part >= 60 is false.
 *   Since source can be ambiguous, we apply H:MM for values where left side <= 12 and right side < 60,
 *   which matches examples from monitor data (waiting times in hours:minutes).
 */
export function parseMinutesValue(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '-' || trimmed.length === 0) {
    return null;
  }

  const match = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const left = Number.parseInt(match[1], 10);
  const right = Number.parseInt(match[2], 10);

  if (right >= 60) {
    return null;
  }

  return (left * 60) + right;
}

export function floorToHourUTC(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    0,
    0,
    0
  ));
}
