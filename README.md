# MonitorPS Scraper (ASL Nuoro / Ospedale San Francesco)

App full-stack en Node.js + TypeScript que scrapea cada hora la tabla de:

`https://monitorps.sardegnasalute.it/monitorps/MonitorServlet`

seleccionando:
- **ASL:** `ASL Nuoro`
- **Ospedale:** `OSPEDALE SAN FRANCESCO`

Luego guarda snapshots históricos en base de datos usando Prisma.

## Stack

- Node.js 20 + TypeScript
- Playwright (headless por defecto)
- Prisma + PostgreSQL
- node-cron (cron interno)
- Express API para validación
- pino logging
- Docker + docker-compose

## Estructura

- `src/scraper`: lógica de scraping y parseo
- `src/scheduler`: cron interno
- `src/server`: endpoints HTTP
- `src/db`: cliente Prisma
- `prisma`: schema y migrations

## Variables de entorno

Ver `.env.example`.

Principales:
- `DATABASE_URL` (obligatoria, Postgres; puede ser pooler)
- `DIRECT_URL` (recomendada para migraciones Prisma cuando `DATABASE_URL` usa pooler, p.ej. Supabase)
- `SCRAPE_INTERVAL_MINUTES` (default: `60`)
- `HEADLESS` (default: `true`)
- `TZ` (default: `UTC`)
- `SAVE_RAW_HTML` (default: `false`)

## Modelo de datos

- `Facility (asl, hospital)` único
- `Snapshot (facilityId, capturedAt, hourBucket, rawHtml?, sourceUrl?)`
- `MetricRow (snapshotId, metricName)`
- `MetricCell (metricRowId, colorCode, valueString, valueNumber?, valueMinutes?)`

Se evita duplicado por hora con índice único `facilityId + hourBucket`.

## Reglas de parseo

- `valueString`: guarda el texto crudo (`"5:38"`, `"-"`, `"12"`, etc.).
- `valueNumber`: entero si aplica (`/^[-]?\d+$/`), si no `null`.
- `valueMinutes`: si formato `H:MM`, se convierte a minutos totales (`1:22 => 82`).
  - Si `-` o no matchea formato, se guarda `null`.

## API mínima

- `GET /health`
- `GET /latest?asl=...&hospital=...`
- `GET /snapshots?asl=...&hospital=...&from=...&to=...`
- `GET /stats/summary?asl=...&hospital=...`
- `GET /stats/trends?asl=...&hospital=...&hours=24`
- `GET /stats/distribution?asl=...&hospital=...&hours=168`
- `GET /dashboard` (HTML simple opcional)

Defaults de consulta:
- `asl=ASL Nuoro`
- `hospital=OSPEDALE SAN FRANCESCO`


## Configuración mínima para que Prisma funcione

1. Definí `DATABASE_URL` con una conexión válida a PostgreSQL.
2. (Opcional pero recomendado) Definí `DIRECT_URL` con conexión directa al nodo Postgres para ejecutar migraciones en proveedores con pooler (Supabase/Neon).
3. Generá el cliente Prisma:
   ```bash
   npm run prisma:generate
   ```
4. Aplicá migraciones:
   ```bash
   npm run migrate:deploy
   ```

> `DATABASE_PROVIDER` ya no se usa en este proyecto porque Prisma requiere un provider estático en el schema.

## Desarrollo local

1. Crear `.env` (podés copiar `.env.example`).
2. Instalar dependencias:
   ```bash
   npm install
   ```
3. Aplicar migraciones (Prisma usará `DIRECT_URL` automáticamente si está definida):
   ```bash
   npm run migrate:deploy
   ```
4. Levantar en dev:
   ```bash
   npm run dev
   ```

## Docker

Levantar app + Postgres:

```bash
docker compose up --build
```

La app corre en `http://localhost:3000`.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run migrate:deploy`
- `npm run prisma:generate`

## Dashboard React (Vercel)

Se agregó una app React en `web/` pensada para desplegar en Vercel.

### Variables recomendadas

- `VITE_API_BASE_URL` apuntando al backend (ej: Render/Railway/Fly/tu VPS).

### Deploy en Vercel (frontend)

1. Importá el repositorio en Vercel.
2. Configurá el **Root Directory** en `web`.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Definí `VITE_API_BASE_URL` con la URL pública del backend.

La API backend sigue corriendo por separado (Node + Prisma + Postgres).

## GitHub Actions

El workflow programado (`.github/workflows/scrape-hourly.yml`) necesita `DATABASE_URL` para poder ejecutar `prisma migrate deploy`.

Configuración recomendada:
- Definir `DATABASE_URL` como **Repository secret**.
- Opcionalmente, definir `DIRECT_URL` para migraciones/direct connection.
- Como fallback, también se aceptan **Repository variables** (`vars.DATABASE_URL` y `vars.DIRECT_URL`).

Si `DATABASE_URL` no está configurada, el workflow falla temprano con un mensaje explícito antes de correr Prisma.

## Resiliencia

- Reintentos de scraping: 2 reintentos (3 intentos totales) con backoff incremental.
- Si falla un ciclo, no crashea el proceso; queda logueado y continúa el scheduler.
