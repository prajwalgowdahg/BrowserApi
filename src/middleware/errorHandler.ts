import type { Request, Response, NextFunction } from 'express';
import { ElementNotFoundError } from '../services/cascadeFinder.js';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('[ERROR]', err.message, err.stack);

  if (res.headersSent) {
    _next(err);
    return;
  }

  const status = (err as unknown as { status?: number }).status ?? 500;
  const message = err.message || 'Internal server error';

  // ERR-02: attach diagnostic screenshot for element-not-found errors
  if (err instanceof ElementNotFoundError) {
    res.status(status).json({
      success: false,
      error: message,
      screenshot: err.screenshot,
    });
    return;
  }

  res.status(status).json({ success: false, error: message });
}
