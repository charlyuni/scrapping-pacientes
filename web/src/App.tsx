import { useEffect, useMemo, useState } from 'react';
import { DistributionResponse, getDistribution, getSummary, getTrends, SummaryResponse, TrendsResponse } from './api';

const COLOR_MAP: Record<string, string> = {
  ROSSO: '#dc2626',
  ARANCIONE: '#ea580c',
  AZZURRO: '#0284c7',
  VERDE: '#16a34a',
  BIANCO: '#6b7280'
};

function formatMinutes(value: number | null) {
  if (value === null) return '-';
  const hours = Math.floor(value / 60);
  const mins = Math.round(value % 60)
    .toString()
    .padStart(2, '0');
  return `${hours}:${mins}`;
}

function TinyTrend({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return <div className="tiny-empty">Sin serie</div>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const width = 170;
  const height = 40;
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((point - min) / span) * height;
      return `${index === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={path} stroke={color} fill="none" strokeWidth={2} />
    </svg>
  );
}

export function App() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [distribution, setDistribution] = useState<DistributionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getSummary(), getTrends(), getDistribution()])
      .then(([summaryData, trendsData, distributionData]) => {
        setSummary(summaryData);
        setTrends(trendsData);
        setDistribution(distributionData);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Error desconocido');
      });
  }, []);

  const trendsByKey = useMemo(() => {
    if (!trends) return new Map<string, number[]>();
    return new Map(
      trends.series.map((series) => [
        `${series.metricName}::${series.colorCode}`,
        series.points
          .map((point) => point.valueNumber ?? point.valueMinutes)
          .filter((point): point is number => typeof point === 'number')
      ])
    );
  }, [trends]);

  if (error) {
    return <main className="container"><h1>Dashboard MonitorPS</h1><p className="error">{error}</p></main>;
  }

  if (!summary || !trends || !distribution) {
    return <main className="container"><h1>Dashboard MonitorPS</h1><p>Cargando datos...</p></main>;
  }

  return (
    <main className="container">
      <header>
        <h1>Dashboard MonitorPS</h1>
        <p>Última actualización: {new Date(summary.latestCapturedAt).toLocaleString()}</p>
      </header>

      <section>
        <h2>Resumen actual (vs snapshot anterior)</h2>
        <div className="cards">
          {summary.cards.map((card) => {
            const key = `${card.metricName}::${card.colorCode}`;
            const trendPoints = trendsByKey.get(key) ?? [];
            return (
              <article key={key} className="card">
                <div className="chip" style={{ background: COLOR_MAP[card.colorCode] ?? '#111827' }}>
                  {card.colorCode}
                </div>
                <h3>{card.metricName}</h3>
                <p className="value">{card.current.valueString}</p>
                <p className="delta">
                  Δ número: {card.deltaNumber ?? '-'} | Δ min: {card.deltaMinutes ?? '-'}
                </p>
                <TinyTrend points={trendPoints} color={COLOR_MAP[card.colorCode] ?? '#111827'} />
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <h2>Distribución (últimos {distribution.hours}h)</h2>
        <table>
          <thead>
            <tr>
              <th>Métrica</th>
              <th>Color</th>
              <th>Muestras</th>
              <th>Prom. número</th>
              <th>Prom. minutos</th>
            </tr>
          </thead>
          <tbody>
            {distribution.distribution.map((row) => (
              <tr key={`${row.metricName}-${row.colorCode}`}>
                <td>{row.metricName}</td>
                <td>{row.colorCode}</td>
                <td>{row.samples}</td>
                <td>{row.avgNumber?.toFixed(2) ?? '-'}</td>
                <td>{formatMinutes(row.avgMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
