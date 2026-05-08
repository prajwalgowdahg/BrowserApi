import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (env.NODE_ENV === 'test') {
    next();
    return;
  }

  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const sessionId = req.params.sessionId ?? req.path.match(/\/sessions\/([^/]+)/)?.[1];
    const sessionPart = sessionId ? ` session=${sessionId}` : '';
    console.log(`[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${durationMs}ms${sessionPart}`);
  });

  next();
}

