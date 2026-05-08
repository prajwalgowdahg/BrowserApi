import { Router } from 'express';
import { success, error } from '../utils/response.js';
import { sessionManager } from '../services/sessionManager.js';
import { actionLogService } from '../services/actionLogService.js';
import { browserEventService } from '../services/browserEventService.js';

export const sessionRouter = Router();

sessionRouter.post('/', async (req, res, next) => {
  try {
    const profileId = typeof req.body?.profileId === 'string' ? req.body.profileId : undefined;
    const session = await sessionManager.create({ profileId });
    actionLogService.append(session.id, { action: 'session.create', status: 'success' });
    return success(res, { sessionId: session.id, profileId: session.profileId }, 201);
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

  actionLogService.append(sessionId, { action: 'session.delete', status: 'success' });
  await sessionManager.delete(sessionId);
  return success(res, { deleted: true });
});

sessionRouter.get('/:sessionId/logs', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.get(sessionId);

  if (!session) {
    return error(res, 'Session not found', 404);
  }

  return success(res, { logs: actionLogService.getLogs(sessionId) });
});

sessionRouter.get('/:sessionId/events', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.get(sessionId);

  if (!session) {
    return error(res, 'Session not found', 404);
  }

  return success(res, { events: browserEventService.getEvents(sessionId) });
});

sessionRouter.get('/:sessionId/network', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.get(sessionId);

  if (!session) {
    return error(res, 'Session not found', 404);
  }

  return success(res, { events: browserEventService.getEvents(sessionId, 'requestfailed') });
});

sessionRouter.get('/:sessionId/console', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.get(sessionId);

  if (!session) {
    return error(res, 'Session not found', 404);
  }

  return success(res, { events: browserEventService.getEvents(sessionId, 'console') });
});
