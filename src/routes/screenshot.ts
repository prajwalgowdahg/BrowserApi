import { Router } from 'express';
import { success, error } from '../utils/response.js';
import { sessionManager } from '../services/sessionManager.js';
import { screenshotPage } from '../utils/thumbnails.js';

export const screenshotRouter = Router();

screenshotRouter.get('/:sessionId/screenshot', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);

    if (!session) {
      return error(res, 'Session not found', 404);
    }

    sessionManager.touch(sessionId);
    const screenshot = await screenshotPage(session.page);
    return success(res, { screenshot });
  } catch (err) {
    next(err);
  }
});
