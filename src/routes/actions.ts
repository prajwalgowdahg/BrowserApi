import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { success, error } from '../utils/response.js';
import { sessionManager } from '../services/sessionManager.js';
import { screenshotPage } from '../utils/thumbnails.js';
import { findElementWithAI } from '../services/cascadeFinder.js';
import { actionLogService } from '../services/actionLogService.js';
import { findRankedElements, locatorForObservedId, locatorForObservedRef, observePage } from '../services/pageObserver.js';
import { detectHumanCheck } from '../services/humanCheckDetector.js';
import { evaluatePolicy } from '../services/policyGate.js';

export const actionsRouter = Router();

type BatchAction = {
  action: string;
  [key: string]: unknown;
};

function storeSnapshot(session: NonNullable<ReturnType<typeof sessionManager.get>>, observation: Awaited<ReturnType<typeof observePage>>) {
  const snapshot = {
    ...observation,
    snapshotId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  session.latestSnapshot = snapshot;
  return snapshot;
}

function latestSnapshotOrThrow(session: NonNullable<ReturnType<typeof sessionManager.get>>) {
  if (!session.latestSnapshot) {
    throw new Error('No snapshot available. Call snapshot first.');
  }
  return session.latestSnapshot;
}

async function clickRef(session: NonNullable<ReturnType<typeof sessionManager.get>>, ref: string) {
  const snapshot = latestSnapshotOrThrow(session);
  const locator = await locatorForObservedRef(session.page, ref, snapshot.elements);
  await locator.click();
  await session.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  return { ref, snapshotId: snapshot.snapshotId, url: session.page.url() };
}

async function fillRef(session: NonNullable<ReturnType<typeof sessionManager.get>>, ref: string, value: string) {
  const snapshot = latestSnapshotOrThrow(session);
  const locator = await locatorForObservedRef(session.page, ref, snapshot.elements);
  await locator.fill(value);
  return { ref, snapshotId: snapshot.snapshotId };
}

async function selectRef(session: NonNullable<ReturnType<typeof sessionManager.get>>, ref: string, value: string) {
  const snapshot = latestSnapshotOrThrow(session);
  const locator = await locatorForObservedRef(session.page, ref, snapshot.elements);
  const tagName = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
  if (tagName === 'select') {
    await locator.selectOption({ label: value });
  } else {
    await locator.click().catch(() => {});
    const choice = session.page.getByText(new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')).first();
    if ((await choice.count().catch(() => 0)) === 0) {
      throw new Error(`Choice not found after opening ${ref}: ${value}`);
    }
    await choice.click({ timeout: 3000 });
  }
  await session.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  return { ref, value, snapshotId: snapshot.snapshotId };
}

async function executeBatchAction(session: NonNullable<ReturnType<typeof sessionManager.get>>, item: BatchAction) {
  switch (item.action) {
    case 'navigate': {
      if (typeof item.url !== 'string') throw new Error('navigate requires url');
      await session.page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await session.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      return { url: session.page.url() };
    }
    case 'snapshot': {
      const limit = Number(item.limit ?? 80);
      return storeSnapshot(session, await observePage(session.page, Number.isFinite(limit) ? limit : 80));
    }
    case 'click_ref':
      if (typeof item.ref !== 'string') throw new Error('click_ref requires ref');
      return clickRef(session, item.ref);
    case 'fill_ref':
      if (typeof item.ref !== 'string') throw new Error('fill_ref requires ref');
      if (typeof item.value !== 'string') throw new Error('fill_ref requires value');
      return fillRef(session, item.ref, item.value);
    case 'select_ref':
      if (typeof item.ref !== 'string') throw new Error('select_ref requires ref');
      if (typeof item.value !== 'string') throw new Error('select_ref requires value');
      return selectRef(session, item.ref, item.value);
    case 'press_key':
      if (typeof item.key !== 'string') throw new Error('press_key requires key');
      await session.page.keyboard.press(item.key);
      return { key: item.key };
    case 'wait_for': {
      const timeout = Number(item.timeout ?? 5000);
      const waitType = typeof item.waitType === 'string' ? item.waitType : 'networkidle';
      if (waitType === 'networkidle') await session.page.waitForLoadState('networkidle', { timeout }).catch(() => {});
      else if (waitType === 'domcontentloaded') await session.page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
      else await session.page.waitForTimeout(Math.max(0, Math.min(timeout, 30000)));
      return { waited: waitType };
    }
    case 'dismiss_overlays': {
      const labels = ['close', 'dismiss', 'cancel', 'not now', 'skip'];
      const dismissed: string[] = [];
      await session.page.keyboard.press('Escape').catch(() => {});
      for (const label of labels) {
        const locator = session.page.getByText(new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')).first();
        if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
          await locator.click({ timeout: 1000 }).catch(() => {});
          dismissed.push(label);
        }
      }
      return { dismissed };
    }
    case 'human_check':
      return detectHumanCheck(session.page);
    default:
      throw new Error(`Unsupported batch action: ${item.action}`);
  }
}

// POST /:sessionId/navigate (NAV-01, NAV-02)
actionsRouter.post('/:sessionId/navigate', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { url } = req.body;
    if (!url) return error(res, 'Missing required field: url', 400);

    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await session.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'navigate', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, url: session.page.url() });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'navigate', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/click (ACT-01, ACT-08)
actionsRouter.post('/:sessionId/click', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { description } = req.body;
    if (!description) return error(res, 'Missing required field: description', 400);

    const result = await findElementWithAI(session.page, description);
    // Vision layer returns coordinates -- use mouse.click for pixel-accurate clicking
    if ('clickedAt' in result && result.clickedAt) {
      await session.page.mouse.click(result.clickedAt.x, result.clickedAt.y);
    } else {
      await result.locator.scrollIntoViewIfNeeded().catch(() => {});
      await result.locator.click();
    }
    await session.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'click', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, strategy: result.strategy });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'click', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/type (ACT-02, ACT-08)
actionsRouter.post('/:sessionId/type', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { description, value } = req.body;
    if (!description) return error(res, 'Missing required field: description', 400);
    if (!value) return error(res, 'Missing required field: value', 400);

    const { locator, strategy } = await findElementWithAI(session.page, description);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.fill(value);
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'type', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, strategy });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'type', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/select (ACT-03, ACT-08)
actionsRouter.post('/:sessionId/select', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { description, value } = req.body;
    if (!description) return error(res, 'Missing required field: description', 400);
    if (!value) return error(res, 'Missing required field: value', 400);

    const { locator, strategy } = await findElementWithAI(session.page, description);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.selectOption({ label: value });
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'select', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, strategy });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'select', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/screenshot/full (ACT-04)
actionsRouter.post('/:sessionId/screenshot/full', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const buffer = await session.page.screenshot({ fullPage: true, type: 'png' });
    actionLogService.append(sessionId, { action: 'screenshot_full', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot: buffer.toString('base64') });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'screenshot_full', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/get_text (ACT-05, ACT-08)
actionsRouter.post('/:sessionId/get_text', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { description } = req.body;
    if (!description) return error(res, 'Missing required field: description', 400);

    const { locator, strategy } = await findElementWithAI(session.page, description);
    const text = await locator.innerText();
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'get_text', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { text, screenshot, strategy });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'get_text', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/wait (ACT-06, ACT-08)
actionsRouter.post('/:sessionId/wait', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
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
    actionLogService.append(sessionId, { action: 'wait', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, waited: waitType });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'wait', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/scroll (ACT-07, ACT-08)
actionsRouter.post('/:sessionId/scroll', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
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
    actionLogService.append(sessionId, { action: 'scroll', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, scrolled: { direction, amount, unit } });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'scroll', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/observe
actionsRouter.post('/:sessionId/observe', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const limit = Number(req.body.limit ?? 80);
    const observation = await observePage(session.page, Number.isFinite(limit) ? limit : 80);
    const snapshot = storeSnapshot(session, observation);
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'observe', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { ...snapshot, screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'observe', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/snapshot
actionsRouter.post('/:sessionId/snapshot', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const limit = Number(req.body.limit ?? 80);
    const observation = await observePage(session.page, Number.isFinite(limit) ? limit : 80);
    const snapshot = storeSnapshot(session, observation);
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'snapshot', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { ...snapshot, screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'snapshot', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/find_elements
actionsRouter.post('/:sessionId/find_elements', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { query } = req.body;
    if (!query || typeof query !== 'string') return error(res, 'Missing required field: query', 400);
    const limit = Number(req.body.limit ?? 10);
    const result = await findRankedElements(session.page, query, Number.isFinite(limit) ? limit : 10);
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'find_elements', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { ...result, screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'find_elements', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/click_ref
actionsRouter.post('/:sessionId/click_ref', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { ref } = req.body;
    if (!ref || typeof ref !== 'string') return error(res, 'Missing required field: ref', 400);
    const result = await clickRef(session, ref);
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'click_ref', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { ...result, screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'click_ref', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/fill_ref
actionsRouter.post('/:sessionId/fill_ref', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { ref, value } = req.body;
    if (!ref || typeof ref !== 'string') return error(res, 'Missing required field: ref', 400);
    if (typeof value !== 'string') return error(res, 'Missing required field: value', 400);
    const result = await fillRef(session, ref, value);
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'fill_ref', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { ...result, screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'fill_ref', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/select_ref
actionsRouter.post('/:sessionId/select_ref', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { ref, value } = req.body;
    if (!ref || typeof ref !== 'string') return error(res, 'Missing required field: ref', 400);
    if (!value || typeof value !== 'string') return error(res, 'Missing required field: value', 400);
    const result = await selectRef(session, ref, value);
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'select_ref', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { ...result, screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'select_ref', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/type_and_press
actionsRouter.post('/:sessionId/type_and_press', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { description, value, key = 'Enter' } = req.body;
    if (!description || typeof description !== 'string') return error(res, 'Missing required field: description', 400);
    if (typeof value !== 'string') return error(res, 'Missing required field: value', 400);

    const result = await findElementWithAI(session.page, description);
    await result.locator.scrollIntoViewIfNeeded().catch(() => {});
    await result.locator.fill(value);
    await result.locator.press(String(key));
    await session.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'type_and_press', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, strategy: result.strategy, key, url: session.page.url() });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'type_and_press', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/select_choice
actionsRouter.post('/:sessionId/select_choice', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { description, value } = req.body;
    if (!description || typeof description !== 'string') return error(res, 'Missing required field: description', 400);
    if (!value || typeof value !== 'string') return error(res, 'Missing required field: value', 400);

    const targetDescription = `${value} option for ${description}`;
    let strategy = '';
    const directChoice = session.page.getByText(new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')).first();
    if ((await directChoice.count().catch(() => 0)) > 0 && (await directChoice.isVisible().catch(() => false))) {
      await directChoice.scrollIntoViewIfNeeded().catch(() => {});
      await directChoice.click({ timeout: 3000 });
      strategy = 'text:exact-choice';
    } else {
      try {
        const field = await findElementWithAI(session.page, description);
        const tagName = await field.locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
        if (tagName === 'select') {
          await field.locator.selectOption({ label: value });
          strategy = `${field.strategy}:native-select`;
        } else {
          throw new Error('not a native select');
        }
      } catch {
        const choice = await findElementWithAI(session.page, targetDescription);
        await choice.locator.scrollIntoViewIfNeeded().catch(() => {});
        if ('clickedAt' in choice && choice.clickedAt) {
          await session.page.mouse.click(choice.clickedAt.x, choice.clickedAt.y);
        } else {
          await choice.locator.click();
        }
        strategy = choice.strategy;
      }
    }

    await session.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'select_choice', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, strategy, value });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'select_choice', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/dismiss_overlays
actionsRouter.post('/:sessionId/dismiss_overlays', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const labels = ['close', 'dismiss', 'cancel', 'not now', 'skip'];
    const dismissed: string[] = [];

    await session.page.keyboard.press('Escape').catch(() => {});
    for (const label of labels) {
      const locator = session.page.getByText(new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')).first();
      if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
        await locator.click({ timeout: 1000 }).catch(() => {});
        dismissed.push(label);
      }
    }

    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'dismiss_overlays', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, dismissed });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'dismiss_overlays', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/press_key
actionsRouter.post('/:sessionId/press_key', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { key } = req.body;
    if (!key || typeof key !== 'string') return error(res, 'Missing required field: key', 400);
    await session.page.keyboard.press(key);
    await session.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'press_key', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, key });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'press_key', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/hover
actionsRouter.post('/:sessionId/hover', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { description } = req.body;
    if (!description || typeof description !== 'string') return error(res, 'Missing required field: description', 400);
    const result = await findElementWithAI(session.page, description);
    await result.locator.scrollIntoViewIfNeeded().catch(() => {});
    await result.locator.hover();
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'hover', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, strategy: result.strategy });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'hover', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/focus
actionsRouter.post('/:sessionId/focus', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { description } = req.body;
    if (!description || typeof description !== 'string') return error(res, 'Missing required field: description', 400);
    const result = await findElementWithAI(session.page, description);
    await result.locator.scrollIntoViewIfNeeded().catch(() => {});
    await result.locator.focus();
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'focus', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, strategy: result.strategy });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'focus', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/clear
actionsRouter.post('/:sessionId/clear', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { description } = req.body;
    if (!description || typeof description !== 'string') return error(res, 'Missing required field: description', 400);
    const result = await findElementWithAI(session.page, description);
    await result.locator.scrollIntoViewIfNeeded().catch(() => {});
    await result.locator.fill('');
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'clear', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, strategy: result.strategy });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'clear', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/click_text
actionsRouter.post('/:sessionId/click_text', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { text, exact = false } = req.body;
    if (!text || typeof text !== 'string') return error(res, 'Missing required field: text', 400);
    const locator = session.page.getByText(text, { exact: Boolean(exact) }).first();
    if ((await locator.count()) === 0) return error(res, `Text not found: ${text}`, 404);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click();
    await session.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'click_text', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, text });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'click_text', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/click_coordinates
actionsRouter.post('/:sessionId/click_coordinates', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const x = Number(req.body.x);
    const y = Number(req.body.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return error(res, 'Missing required numeric fields: x, y', 400);

    await session.page.mouse.click(x, y);
    await session.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'click_coordinates', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, clickedAt: { x, y } });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'click_coordinates', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/click_observed
actionsRouter.post('/:sessionId/click_observed', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { id } = req.body;
    if (!id || typeof id !== 'string') return error(res, 'Missing required field: id', 400);
    const locator = await locatorForObservedId(session.page, id);
    await locator.click();
    await session.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'click_observed', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, id });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'click_observed', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/batch
actionsRouter.post('/:sessionId/batch', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const actions = Array.isArray(req.body.actions) ? req.body.actions as BatchAction[] : [];
    if (actions.length === 0) return error(res, 'Missing required field: actions', 400);
    const includeScreenshots = req.body.screenshots !== false;
    const results: Array<Record<string, unknown>> = [];
    let stopReason: string | undefined;

    for (const [index, item] of actions.entries()) {
      const policy = evaluatePolicy({
        taskType: 'web.batch',
        action: item.action,
        text: JSON.stringify(item),
      });
      if (policy.needsApproval) {
        stopReason = 'needs_approval';
        results.push({ index, action: item.action, status: 'needs_approval', evidence: policy.evidence });
        break;
      }

      try {
        const data = await executeBatchAction(session, item);
        const humanCheck = await detectHumanCheck(session.page);
        const screenshot = includeScreenshots ? await screenshotPage(session.page) : undefined;
        results.push({ index, action: item.action, status: 'success', data, humanCheck, screenshot });
        if (humanCheck.required) {
          stopReason = 'needs_human';
          break;
        }
      } catch (err) {
        stopReason = 'failed';
        results.push({ index, action: item.action, status: 'failed', error: (err as Error).message });
        break;
      }
    }

    actionLogService.append(sessionId, { action: 'batch', status: stopReason === 'failed' ? 'fail' : 'success', durationMs: Date.now() - startTime });
    return success(res, {
      status: stopReason ?? 'completed',
      stopReason,
      results,
      url: session.page.url(),
    });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'batch', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// POST /:sessionId/human_check
actionsRouter.post('/:sessionId/human_check', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const result = await detectHumanCheck(session.page);
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, {
      action: 'human_check',
      status: 'success',
      durationMs: Date.now() - startTime,
    });
    return success(res, { ...result, screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'human_check', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});
