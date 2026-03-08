export interface SummaryResponse {
  latestCapturedAt: string;
  previousCapturedAt: string | null;
  cards: Array<{
    metricName: string;
    colorCode: string;
    current: {
      valueString: string;
      valueNumber: number | null;
      valueMinutes: number | null;
    };
    previous: {
      valueString: string;
      valueNumber: number | null;
      valueMinutes: number | null;
    } | null;
    deltaNumber: number | null;
    deltaMinutes: number | null;
  }>;
}

export interface TrendsResponse {
  hours: number;
  snapshots: number;
  series: Array<{
    metricName: string;
    colorCode: string;
    points: Array<{
      capturedAt: string;
      valueString: string;
      valueNumber: number | null;
      valueMinutes: number | null;
    }>;
  }>;
}

export interface DistributionResponse {
  hours: number;
  snapshots: number;
  distribution: Array<{
    metricName: string;
    colorCode: string;
    samples: number;
    avgNumber: number | null;
    avgMinutes: number | null;
  }>;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const REQUEST_TIMEOUT_MS = 15_000;

async function fetchJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const response = await fetch(`${API_BASE}${path}`, {
    signal: controller.signal
  }).finally(() => {
    clearTimeout(timeoutId);
  });

  if (!response.ok) {
    throw new Error(`API ${path} failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getSummary() {
  return fetchJson<SummaryResponse>('/stats/summary');
}

export function getTrends(hours = 24) {
  return fetchJson<TrendsResponse>(`/stats/trends?hours=${hours}`);
}

export function getDistribution(hours = 24 * 7) {
  return fetchJson<DistributionResponse>(`/stats/distribution?hours=${hours}`);
}
