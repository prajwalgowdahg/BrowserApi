import { Router } from 'express';
import { z } from 'zod';
import { success, error } from '../utils/response.js';
import { sessionManager } from '../services/sessionManager.js';
import { screenshotPage } from '../utils/thumbnails.js';
import { findElementWithAI } from '../services/cascadeFinder.js';
import { actionLogService } from '../services/actionLogService.js';
import { bookingSearchHotels, flipkartSearchProduct, flipkartSelectSize, googleFlightsSearch, searchSite } from '../services/siteAdapters.js';

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
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await session.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    // Step 2: Fill username
    const userResult = await findElementWithAI(session.page, usernameDescription);
    await userResult.locator.scrollIntoViewIfNeeded().catch(() => {});
    await userResult.locator.fill(username);

    // Step 3: Fill password
    const passResult = await findElementWithAI(session.page, passwordDescription);
    await passResult.locator.scrollIntoViewIfNeeded().catch(() => {});
    await passResult.locator.fill(password);

    // Step 4: Click submit (handle vision coordinate clicks)
    const submitResult = await findElementWithAI(session.page, submitDescription);
    if ('clickedAt' in submitResult && submitResult.clickedAt) {
      await session.page.mouse.click(submitResult.clickedAt.x, submitResult.clickedAt.y);
    } else {
      await submitResult.locator.scrollIntoViewIfNeeded().catch(() => {});
      await submitResult.locator.click();
    }

    // Step 5: Wait for navigation to settle
    await session.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

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
      await locator.scrollIntoViewIfNeeded().catch(() => {});
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
      await result.locator.scrollIntoViewIfNeeded().catch(() => {});
      await result.locator.click();
    }

    // Wait for page to settle after form submission
    await session.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

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

// ---------------------------------------------------------------------------
// COMP-05: Generic site search
// ---------------------------------------------------------------------------

compoundsRouter.post('/:sessionId/search_site', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { url, query } = req.body;
    if (!query || typeof query !== 'string') return error(res, 'Missing required field: query', 400);
    const result = await searchSite(session.page, typeof url === 'string' ? url : undefined, query);
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'search_site', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { ...result, screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'search_site', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// COMP-06: Flipkart product search
// ---------------------------------------------------------------------------

compoundsRouter.post('/:sessionId/flipkart_search_product', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { query, filters } = req.body;
    if (!query || typeof query !== 'string') return error(res, 'Missing required field: query', 400);
    const result = await flipkartSearchProduct(
      session.page,
      query,
      filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : undefined,
    );
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'flipkart_search_product', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { ...result, screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'flipkart_search_product', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// COMP-07: Flipkart size selection
// ---------------------------------------------------------------------------

compoundsRouter.post('/:sessionId/flipkart_select_size', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { size } = req.body;
    if (!size || typeof size !== 'string') return error(res, 'Missing required field: size', 400);
    const result = await flipkartSelectSize(session.page, size);
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'flipkart_select_size', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { ...result, screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'flipkart_select_size', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// COMP-08: Booking.com hotel search
// ---------------------------------------------------------------------------

compoundsRouter.post('/:sessionId/booking_search_hotels', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { destination, dates, guests, rooms, budgetMax, currency } = req.body;
    if (!destination || typeof destination !== 'string') return error(res, 'Missing required field: destination', 400);
    const result = await bookingSearchHotels(
      session.page,
      destination,
      dates && typeof dates === 'object' && !Array.isArray(dates) ? dates : undefined,
      guests && typeof guests === 'object' && !Array.isArray(guests) ? guests : undefined,
      typeof rooms === 'number' ? rooms : undefined,
      typeof budgetMax === 'number' ? budgetMax : undefined,
      typeof currency === 'string' ? currency : undefined,
    );
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'booking_search_hotels', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { ...result, screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'booking_search_hotels', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// COMP-09: Google Flights search
// ---------------------------------------------------------------------------

compoundsRouter.post('/:sessionId/google_flights_search', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.get(sessionId);
    if (!session) return error(res, 'Session not found', 404);

    const startTime = Date.now();
    sessionManager.touch(sessionId);

    const { origin, destination, departDate, tripType, returnDate, passengers, cabin, preference } = req.body;
    if (!origin || typeof origin !== 'string') return error(res, 'Missing required field: origin', 400);
    if (!destination || typeof destination !== 'string') return error(res, 'Missing required field: destination', 400);
    if (!departDate || typeof departDate !== 'string') return error(res, 'Missing required field: departDate', 400);

    const result = await googleFlightsSearch(session.page, {
      origin,
      destination,
      departDate,
      tripType: tripType === 'round-trip' ? 'round-trip' : 'one-way',
      returnDate: typeof returnDate === 'string' ? returnDate : undefined,
      passengers: typeof passengers === 'number' ? passengers : undefined,
      cabin: typeof cabin === 'string' ? cabin : undefined,
      preference: typeof preference === 'string' ? preference : undefined,
    });
    const screenshot = await screenshotPage(session.page);
    actionLogService.append(sessionId, { action: 'google_flights_search', status: 'success', durationMs: Date.now() - startTime });
    return success(res, { ...result, screenshot });
  } catch (err) {
    const { sessionId } = req.params;
    actionLogService.append(sessionId, { action: 'google_flights_search', status: 'fail', error: (err as Error).message, durationMs: 0 });
    next(err);
  }
});
