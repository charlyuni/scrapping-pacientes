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
- `DATABASE_URL` (obligatoria, Postgres)
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
- `GET /dashboard` (HTML simple opcional)

Defaults de consulta:
- `asl=ASL Nuoro`
- `hospital=OSPEDALE SAN FRANCESCO`


## Configuración mínima para que Prisma funcione

1. Definí `DATABASE_URL` con una conexión válida a PostgreSQL.
2. Generá el cliente Prisma:
   ```bash
   npm run prisma:generate
   ```
3. Aplicá migraciones:
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
3. Aplicar migraciones:
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
