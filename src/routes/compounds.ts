import { Router } from 'express';
import { z } from 'zod';
import { success, error } from '../utils/response.js';
import { sessionManager } from '../services/sessionManager.js';
import { screenshotPage } from '../utils/thumbnails.js';
import { findElementWithAI } from '../services/cascadeFinder.js';
import { actionLogService } from '../services/actionLogService.js';

export const compoundsRouter = Router();

// ---------------------------------------------------------------------------
// COMP-01: Login flow
// ---------------------------------------------------------------------------

compoundsRouter.post('/:sessionId/login', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { url, username, password } = req.body;
    if (!url) return error(res, 'Missing required field: url', 400);
    if (!username) return error(res, 'Missing required field: username', 400);
    if (!password) return error(res, 'Missing required field: password', 400);

    const usernameDescription = req.body.usernameDescription ?? 'the email or username input';
    const passwordDescription = req.body.passwordDescription ?? 'the password input';
    const submitDescription = req.body.submitDescription ?? 'the login or submit button';

    // Step 1: Navigate
    await session.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Step 2: Fill username
    const userResult = await findElementWithAI(session.page, usernameDescription);
    await userResult.locator.fill(username);

    // Step 3: Fill password
    const passResult = await findElementWithAI(session.page, passwordDescription);
    await passResult.locator.fill(password);

    // Step 4: Click submit (handle vision coordinate clicks)
    const submitResult = await findElementWithAI(session.page, submitDescription);
    if ('clickedAt' in submitResult && submitResult.clickedAt) {
      await session.page.mouse.click(submitResult.clickedAt.x, submitResult.clickedAt.y);
    } else {
      await submitResult.locator.click();
    }

    // Step 5: Wait for navigation to settle
    await session.page.waitForLoadState('networkidle', { timeout: 10000 });

    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'login', status: 'success', durationMs: Date.now() - startTime });
    return success(res, {
      screenshot,
      url: session.page.url(),
      steps: [
        { step: 'navigate', status: 'completed' },
        { step: 'type_username', status: 'completed', strategy: userResult.strategy },
        { step: 'type_password', status: 'completed', strategy: passResult.strategy },
        { step: 'click_submit', status: 'completed', strategy: submitResult.strategy },
      ],
    });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'login', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// COMP-02: Fill form
// ---------------------------------------------------------------------------

const fieldSchema = z.object({
  description: z.string().min(1, 'Field description is required'),
  value: z.string().min(1, 'Field value is required'),
});

const fillFormSchema = z.object({
  fields: z.array(fieldSchema).min(1, 'At least one field is required'),
});

compoundsRouter.post('/:sessionId/fill_form', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const parsed = fillFormSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const { fields } = parsed.data;
    const results: Array<{ description: string; strategy: string; status: string }> = [];

    for (const field of fields) {
      const { locator, strategy } = await findElementWithAI(session.page, field.description);
      await locator.fill(field.value);
      results.push({ description: field.description, strategy, status: 'completed' });
    }

    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'fill_form', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { screenshot, fields: results });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'fill_form', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// COMP-03: Scrape (structured data extraction)
// ---------------------------------------------------------------------------

compoundsRouter.post('/:sessionId/scrape', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { schema } = req.body;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || Object.keys(schema).length === 0) {
      return error(res, 'Missing required field: schema (non-empty object mapping field names to element descriptions)', 400);
    }
    for (const [key, val] of Object.entries(schema)) {
      if (typeof val !== 'string') {
        return error(res, `Schema field "${key}" must be a string description`, 400);
      }
    }

    const data: Record<string, string> = {};
    const fields: Array<{ field: string; strategy: string }> = [];

    for (const [fieldName, description] of Object.entries(schema)) {
      const result = await findElementWithAI(session.page, description as string);
      const text = await result.locator.innerText();
      data[fieldName] = text;
      fields.push({ field: fieldName, strategy: result.strategy });
    }

    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'scrape', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { data, screenshot, fields });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'scrape', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// COMP-04: Submit form
// ---------------------------------------------------------------------------

compoundsRouter.post('/:sessionId/submit_form', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const description = req.body.description ?? 'the submit button';

    const result = await findElementWithAI(session.page, description);

    // Handle vision coordinate clicks vs locator clicks
    if ('clickedAt' in result && result.clickedAt) {
      await session.page.mouse.click(result.clickedAt.x, result.clickedAt.y);
    } else {
      await result.locator.click();
    }

    // Wait for page to settle after form submission
    await session.page.waitForLoadState('networkidle', { timeout: 10000 });

    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'submit_form', status: 'success', durationMs: Date.now() - startTime });
    return success(res, {
      screenshot,
      url: session.page.url(),
      strategy: result.strategy,
    });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'submit_form', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});
