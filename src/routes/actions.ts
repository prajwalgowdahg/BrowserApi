import { Router } from 'express';
import { success, error } from '../utils/response.js';
import { sessionManager } from '../services/sessionManager.js';
import { screenshotPage } from '../utils/thumbnails.js';
import { findElementWithAI } from '../services/cascadeFinder.js';

export const actionsRouter = Router();

// POST /:sessionId/navigate (NAV-01, NAV-02)
actionsRouter.post('/:sessionId/navigate', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    sessionManager.touch(sessionId);

    const { url } = req.body;
    if (!url) return error(res, 'Missing required field: url', 400);

    await session.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const screenshot = await screenshotPage(session.page);
    return success(res, { screenshot, url: session.page.url() });
  } catch (err) {
    next(err);
  }
});

// POST /:sessionId/click (ACT-01, ACT-08)
actionsRouter.post('/:sessionId/click', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    sessionManager.touch(sessionId);

    const { description } = req.body;
    if (!description) return error(res, 'Missing required field: description', 400);

    const result = await findElementWithAI(session.page, description);
    // Vision layer returns coordinates -- use mouse.click for pixel-accurate clicking
    if ('clickedAt' in result && result.clickedAt) {
      await session.page.mouse.click(result.clickedAt.x, result.clickedAt.y);
    } else {
      await result.locator.click();
    }
    const screenshot = await screenshotPage(session.page);
    return success(res, { screenshot, strategy: result.strategy });
  } catch (err) {
    next(err);
  }
});

// POST /:sessionId/type (ACT-02, ACT-08)
actionsRouter.post('/:sessionId/type', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    sessionManager.touch(sessionId);

    const { description, value } = req.body;
    if (!description) return error(res, 'Missing required field: description', 400);
    if (!value) return error(res, 'Missing required field: value', 400);

    const { locator, strategy } = await findElementWithAI(session.page, description);
    await locator.fill(value);
    const screenshot = await screenshotPage(session.page);
    return success(res, { screenshot, strategy });
  } catch (err) {
    next(err);
  }
});

// POST /:sessionId/select (ACT-03, ACT-08)
actionsRouter.post('/:sessionId/select', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    sessionManager.touch(sessionId);

    const { description, value } = req.body;
    if (!description) return error(res, 'Missing required field: description', 400);
    if (!value) return error(res, 'Missing required field: value', 400);

    const { locator, strategy } = await findElementWithAI(session.page, description);
    await locator.selectOption({ label: value });
    const screenshot = await screenshotPage(session.page);
    return success(res, { screenshot, strategy });
  } catch (err) {
    next(err);
  }
});

// POST /:sessionId/screenshot/full (ACT-04)
actionsRouter.post('/:sessionId/screenshot/full', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    sessionManager.touch(sessionId);

    const buffer = await session.page.screenshot({ fullPage: true, type: 'png' });
    return success(res, { screenshot: buffer.toString('base64') });
  } catch (err) {
    next(err);
  }
});

// POST /:sessionId/get_text (ACT-05, ACT-08)
actionsRouter.post('/:sessionId/get_text', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    sessionManager.touch(sessionId);

    const { description } = req.body;
    if (!description) return error(res, 'Missing required field: description', 400);

    const { locator, strategy } = await findElementWithAI(session.page, description);
    const text = await locator.innerText();
    const screenshot = await screenshotPage(session.page);
    return success(res, { text, screenshot, strategy });
  } catch (err) {
    next(err);
  }
});

// POST /:sessionId/wait (ACT-06, ACT-08)
actionsRouter.post('/:sessionId/wait', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    sessionManager.touch(sessionId);

    const { description, waitType = 'element', timeout = 10000 } = req.body;

    switch (waitType) {
      case 'element': {
        if (!description) return error(res, 'Missing required field: description for element wait', 400);
        const { locator } = await findElementWithAI(session.page, description);
        await locator.waitFor({ state: 'visible', timeout });
        break;
      }
      case 'navigation':
        await session.page.waitForURL('**', { timeout });
        break;
      case 'networkidle':
        await session.page.waitForLoadState('networkidle', { timeout });
        break;
      default:
        return error(res, `Unknown waitType: ${waitType}`, 400);
    }

    const screenshot = await screenshotPage(session.page);
    return success(res, { screenshot, waited: waitType });
  } catch (err) {
    next(err);
  }
});

// POST /:sessionId/scroll (ACT-07, ACT-08)
actionsRouter.post('/:sessionId/scroll', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    sessionManager.touch(sessionId);

    const direction = req.body.direction ?? 'down';
    const amount = req.body.amount ?? 500;
    const unit = req.body.unit ?? 'pixels';

    let deltaPixels = amount;
    if (unit === 'percentage') {
      const scrollHeight = await session.page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      deltaPixels = scrollHeight * (amount / 100);
    }

    const deltaY = direction === 'down' ? deltaPixels : -deltaPixels;
    await session.page.mouse.wheel(0, deltaY);
    await session.page.waitForTimeout(300);

    const screenshot = await screenshotPage(session.page);
    return success(res, { screenshot, scrolled: { direction, amount, unit } });
  } catch (err) {
    next(err);
  }
});
