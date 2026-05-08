import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { v1Error } from '../utils/v1Response.js';

const buckets = new Map<string, { count: number; resetAt: number }>();

function configuredKeys(): Set<string> {
  return new Set((env.API_KEYS ?? '').split(',').map((key) => key.trim()).filter(Boolean));
}

export function v1Access(req: Request, res: Response, next: NextFunction): void {
  const keys = configuredKeys();
  if (keys.size > 0) {
    const header = req.header('x-api-key') ?? '';
    if (!keys.has(header)) {
      v1Error(res, {
        errorCode: 'UNAUTHORIZED',
        message: 'Missing or invalid x-api-key.',
        retryable: false,
      }, { requestId: req.header('x-request-id') ?? undefined }, 401);
      return;
    }
  }

  const projectId = req.header('x-project-id') ?? req.header('x-api-key') ?? 'default';
  const now = Date.now();
  const bucket = buckets.get(projectId) ?? { count: 0, resetAt: now + 60_000 };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + 60_000;
  }
  bucket.count++;
  buckets.set(projectId, bucket);

  if (bucket.count > env.V1_RATE_LIMIT_PER_MINUTE) {
    v1Error(res, {
      errorCode: 'RATE_LIMITED',
      message: 'Project rate limit exceeded.',
      retryable: true,
    }, { requestId: req.header('x-request-id') ?? undefined, projectId }, 429);
    return;
  }

  next();
}

