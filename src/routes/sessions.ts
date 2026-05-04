import { Router } from 'express';
import { success, error } from '../utils/response.js';
import { sessionManager } from '../services/sessionManager.js';

export const sessionRouter = Router();

sessionRouter.post('/', async (req, res, next) => {
  try {
    const session = await sessionManager.create();
    return success(res, { sessionId: session.id }, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Maximum concurrent sessions')) {
      return error(res, message, 429);
    }
    next(err);
  }
});

sessionRouter.delete('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.get(sessionId);

  if (!session) {
    return error(res, 'Session not found', 404);
  }

  await sessionManager.delete(sessionId);
  return success(res, { deleted: true });
});
