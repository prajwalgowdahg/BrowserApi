import type { Response } from 'express';

interface SuccessResponse<T> {
  success: true;
  data: T;
}

interface ErrorResponse {
  success: false;
  error: string;
  screenshot?: string;
}

export function success<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ success: true, data } satisfies SuccessResponse<T>);
}

export function error(res: Response, message: string, status = 500): Response {
  return res.status(status).json({ success: false, error: message } satisfies ErrorResponse);
}
