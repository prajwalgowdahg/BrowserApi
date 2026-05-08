import type { Response } from 'express';

export type V1Status = 'queued' | 'running' | 'needs_human' | 'needs_approval' | 'completed' | 'blocked' | 'failed' | 'cancelled';

export interface V1Meta {
  sessionId?: string;
  taskId?: string;
  status?: V1Status;
  durationMs?: number;
  requestId?: string;
  projectId?: string;
}

export interface V1ErrorBody {
  errorCode: string;
  message: string;
  retryable: boolean;
  screenshot?: string;
  evidence?: string[];
}

export function v1Success<T>(res: Response, data: T, meta: V1Meta = {}, status = 200): Response {
  return res.status(status).json({
    success: true,
    data,
    meta,
  });
}

export function v1Error(
  res: Response,
  errorBody: V1ErrorBody,
  meta: V1Meta = {},
  status = 500,
): Response {
  return res.status(status).json({
    success: false,
    error: errorBody,
    meta,
  });
}

