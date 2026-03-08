import { useEffect, useMemo, useState } from 'react';
import { getWaitingPatientsStats, WaitingPatientsResponse } from './api';

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' }
];

function formatValue(value: number | null, digits = 1) {
  return value === null ? '-' : value.toFixed(digits);
}

export function App() {
  const [hours, setHours] = useState(24 * 14);
  const [dayType, setDayType] = useState<'ALL' | 'WEEKDAY' | 'WEEKEND'>('ALL');
  const [colorCode, setColorCode] = useState('ALL');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [data, setData] = useState<WaitingPatientsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);

    getWaitingPatientsStats({ hours, dayType, weekdays, colorCode })
      .then((response) => {
        setData(response);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Error desconocido');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [hours, dayType, weekdays, colorCode]);

  const lastPoints = useMemo(() => data?.series.slice(-12) ?? [], [data]);

  return (
    <main className="container">
      <header className="header-row">
        <div>
          <h1>Dashboard MonitorPS</h1>
          <p className="subtitle">Métrica única: <strong>Pazienti in attesa di visita</strong></p>
        </div>
      </header>

      <section className="card filters">
        <h2>Filtros analíticos</h2>
        <div className="filters-grid">
          <label>
            Ventana (horas)
            <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
              <option value={24 * 3}>72h</option>
              <option value={24 * 7}>7 días</option>
              <option value={24 * 14}>14 días</option>
              <option value={24 * 30}>30 días</option>
            </select>
          </label>

          <label>
            Tipo de día
            <select value={dayType} onChange={(event) => setDayType(event.target.value as 'ALL' | 'WEEKDAY' | 'WEEKEND')}>
              <option value="ALL">Todos</option>
              <option value="WEEKDAY">Solo semana</option>
              <option value="WEEKEND">Solo fin de semana</option>
            </select>
          </label>

          <label>
            Color (triage)
            <select value={colorCode} onChange={(event) => setColorCode(event.target.value)}>
              <option value="ALL">Todos</option>
              <option value="ROSSO">ROSSO</option>
              <option value="ARANCIONE">ARANCIONE</option>
              <option value="AZZURRO">AZZURRO</option>
              <option value="VERDE">VERDE</option>
              <option value="BIANCO">BIANCO</option>
            </select>
          </label>
        </div>

        <div className="weekday-filters">
          {WEEKDAY_OPTIONS.map((day) => {
            const selected = weekdays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                className={selected ? 'weekday active' : 'weekday'}
                onClick={() => {
                  setWeekdays((prev) => selected ? prev.filter((value) => value !== day.value) : [...prev, day.value]);
                }}
              >
                {day.label}
              </button>
            );
          })}
          <button type="button" className="weekday clear" onClick={() => setWeekdays([])}>Limpiar días</button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      {loading && <p>Cargando estadísticas...</p>}

      {data && !loading && (
        <>
          <section className="cards">
            <article className="card">
              <h3>Pacientes en espera (actual)</h3>
              <p className="value">{data.latest?.totalWaiting ?? '-'}</p>
              <p className="delta">Δ vs snapshot previo: {data.latest?.deltaVsPrevious ?? '-'}</p>
            </article>
            <article className="card">
              <h3>Promedio semana</h3>
              <p className="value">{formatValue(data.dayTypeStats.weekday.avgWaiting)}</p>
              <p className="delta">Pico: {data.dayTypeStats.weekday.peakWaiting ?? '-'} | muestras: {data.dayTypeStats.weekday.samples}</p>
            </article>
            <article className="card">
              <h3>Promedio fin de semana</h3>
              <p className="value">{formatValue(data.dayTypeStats.weekend.avgWaiting)}</p>
              <p className="delta">Pico: {data.dayTypeStats.weekend.peakWaiting ?? '-'} | muestras: {data.dayTypeStats.weekend.samples}</p>
            </article>
            <article className="card">
              <h3>Snapshots</h3>
              <p className="value">{data.snapshotsAfterFilters}</p>
              <p className="delta">Total ventana: {data.snapshotsInWindow}</p>
            </article>
          </section>

          <section className="card">
            <h2>Picos por día de la semana</h2>
            <table>
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Muestras</th>
                  <th>Promedio espera</th>
                  <th>Pico espera</th>
                </tr>
              </thead>
              <tbody>
                {data.weekdayStats.map((row) => (
                  <tr key={row.weekday}>
                    <td>{row.weekdayLabel}</td>
                    <td>{row.samples}</td>
                    <td>{formatValue(row.avgWaiting)}</td>
                    <td>{row.peakWaiting ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2>Últimos puntos de la serie</h2>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Día</th>
                  <th>Tipo</th>
                  <th>Total en espera</th>
                </tr>
              </thead>
              <tbody>
                {lastPoints.map((point) => (
                  <tr key={point.capturedAt}>
                    <td>{new Date(point.capturedAt).toLocaleString()}</td>
                    <td>{point.weekdayLabel}</td>
                    <td>{point.dayType}</td>
                    <td>{point.totalWaiting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
