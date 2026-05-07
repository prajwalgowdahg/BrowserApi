import { Router } from 'express';
import { success, error } from '../utils/response.js';
import { sessionManager } from '../services/sessionManager.js';
import { screenshotPage } from '../utils/thumbnails.js';
import { actionLogService } from '../services/actionLogService.js';

export const screenshotRouter = Router();

screenshotRouter.get('/:sessionId/screenshot', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);

    if (!session) {
      return error(res, 'Session not found', 404);
    }

    const startTime = Date.now();
    sessionManager.touch(sessionId);
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'screenshot', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'screenshot', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});
