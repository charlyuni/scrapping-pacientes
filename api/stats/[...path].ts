import { createApp } from '../../src/server/app.js';

const app = createApp();

export default function handler(req: { url?: string }, res: unknown) {
  if (req.url?.startsWith('/api')) {
    req.url = req.url.slice('/api'.length) || '/';
  }

  return app(req as never, res as never);
}
