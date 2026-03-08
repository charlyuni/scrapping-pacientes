import type { Request, Response } from 'express';

let appPromise: Promise<((req: Request, res: Response) => unknown)> | null = null;

async function getApp() {
  if (!appPromise) {
    appPromise = import('../src/server/app.js').then(({ createApp }) => createApp() as (req: Request, res: Response) => unknown);
  }

  return appPromise;
}

function normalizeUrl(req: { url?: string }) {
  if (req.url?.startsWith('/api')) {
    req.url = req.url.slice('/api'.length) || '/';
  }
}

function sendBootstrapError(res: unknown, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const payload = {
    error: 'Server bootstrap failed',
    message,
    hint: 'Verify runtime env vars (DATABASE_URL, DIRECT_URL) in production deployment.'
  };

  if (res && typeof (res as { status?: unknown }).status === 'function') {
    ((res as { status(code: number): { json(body: unknown): void } }).status(500)).json(payload);
    return;
  }

  if (res && typeof (res as { end?: unknown }).end === 'function') {
    (res as { end(body: string): void }).end(JSON.stringify(payload));
  }
}

export default async function handler(req: { url?: string }, res: unknown) {
  try {
    const app = await getApp();
    normalizeUrl(req);
    return app(req as Request, res as Response);
  } catch (error) {
    console.error('API bootstrap error:', error instanceof Error ? error.message : String(error));
    sendBootstrapError(res, error);
    return undefined;
  }
}
