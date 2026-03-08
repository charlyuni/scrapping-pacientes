export interface WaitingPatientsResponse {
  metricName: string;
  filters: {
    hours: number;
    dayType: 'ALL' | 'WEEKDAY' | 'WEEKEND';
    weekdays: number[] | null;
    colorCode: string;
  };
  latest: {
    capturedAt: string;
    totalWaiting: number;
    deltaVsPrevious: number | null;
    byColor: Record<string, number>;
  } | null;
  snapshotsInWindow: number;
  snapshotsAfterFilters: number;
  series: Array<{
    capturedAt: string;
    totalWaiting: number;
    weekday: number;
    weekdayLabel: string;
    dayType: 'WEEKDAY' | 'WEEKEND';
  }>;
  dayTypeStats: {
    weekday: {
      samples: number;
      avgWaiting: number | null;
      peakWaiting: number | null;
    };
    weekend: {
      samples: number;
      avgWaiting: number | null;
      peakWaiting: number | null;
    };
  };
  weekdayStats: Array<{
    weekday: number;
    weekdayLabel: string;
    samples: number;
    avgWaiting: number | null;
    peakWaiting: number | null;
  }>;
  topPeakDays: Array<{
    weekday: number;
    weekdayLabel: string;
    samples: number;
    avgWaiting: number | null;
    peakWaiting: number | null;
  }>;
  latestSnapshot: {
    capturedAt: string;
    sourceUrl: string | null;
    rawHtml: string | null;
    tableRows: Array<{
      metricName: string;
      byColor: Record<string, string>;
    }>;
  } | null;
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

export function getWaitingPatientsStats(params: {
  hours: number;
  dayType: 'ALL' | 'WEEKDAY' | 'WEEKEND';
  weekdays: number[];
  colorCode: string;
}) {
  const query = new URLSearchParams({
    hours: String(params.hours),
    dayType: params.dayType,
    colorCode: params.colorCode
  });

  if (params.weekdays.length > 0) {
    query.set('weekdays', params.weekdays.join(','));
  }

  return fetchJson<WaitingPatientsResponse>(`/stats/waiting-patients?${query.toString()}`);
}
