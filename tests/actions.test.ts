import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { launchBrowser, closeBrowser } from '../src/services/browserManager.js';
import { sessionManager } from '../src/services/sessionManager.js';

// Button is type="button" (not submit) to prevent form navigation on click
// which causes Playwright to wait for a navigation that never happens.
const FORM_HTML = `data:text/html,${encodeURIComponent(
  '<form>' +
    '<label for="email">Email</label>' +
    '<input type="email" id="email" placeholder="Enter your email">' +
    '<label for="password">Password</label>' +
    '<input type="password" id="password" placeholder="Enter password">' +
    '<select id="country"><option value="us">United States</option><option value="uk">United Kingdom</option></select>' +
    '<button type="button" id="submitBtn">Submit</button>' +
    '<h1>Test Form</h1>' +
    '</form>',
)}`;

const TALL_HTML = `data:text/html,${encodeURIComponent(
  '<div style="height: 3000px; padding: 20px;">' +
    '<h1 id="top">Top</h1>' +
    '<p id="middle" style="margin-top: 1500px;">Middle</p>' +
    '<p id="bottom" style="margin-top: 2800px;">Bottom</p>' +
    '</div>',
)}`;

const SIMPLE_HTML = 'data:text/html,<h1>Hello</h1>';

async function createSessionAndNavigate(
  app: ReturnType<typeof createApp>,
  html: string,
): Promise<{ sessionId: string }> {
  const createRes = await request(app).post('/sessions');
  expect(createRes.status).toBe(201);
  const sessionId = createRes.body.data.sessionId;

  // Navigate via the action endpoint itself
  const navRes = await request(app)
    .post(`/sessions/${sessionId}/navigate`)
    .send({ url: html });
  expect(navRes.status).toBe(200);

  return { sessionId };
}

describe(
  'Action routes',
  { timeout: 60_000 },
  () => {
    const app = createApp();
    const cleanupIds: string[] = [];

    beforeAll(async () => {
      await launchBrowser();
    });

    afterAll(async () => {
      // Clean up any sessions that were not deleted in tests
      for (const id of cleanupIds) {
        try {
          await sessionManager.delete(id);
        } catch {
          // ignore -- session may already be deleted
        }
      }
      await sessionManager.shutdown();
      await closeBrowser();
    });

    // --- NAV-01/02: Navigate ---
    it('POST /sessions/:id/navigate returns 200 with screenshot and current URL', async () => {
      const createRes = await request(app).post('/sessions');
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.data.sessionId;
      cleanupIds.push(sessionId);

      const res = await request(app)
        .post(`/sessions/${sessionId}/navigate`)
        .send({ url: SIMPLE_HTML });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.screenshot).toBe('string');
      expect(res.body.data.url).toContain('data:text/html');

      await sessionManager.delete(sessionId);
    });

    it('POST /sessions/:id/navigate returns 400 when url is missing', async () => {
      const createRes = await request(app).post('/sessions');
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.data.sessionId;
      cleanupIds.push(sessionId);

      const res = await request(app)
        .post(`/sessions/${sessionId}/navigate`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);

      await sessionManager.delete(sessionId);
    });

    // --- ACT-01: Click ---
    it('POST /sessions/:id/click clicks the submit button and returns screenshot + strategy', async () => {
      const { sessionId } = await createSessionAndNavigate(app, FORM_HTML);
      cleanupIds.push(sessionId);

      const res = await request(app)
        .post(`/sessions/${sessionId}/click`)
        .send({ description: 'the submit button' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.screenshot).toBe('string');
      expect(res.body.data.strategy).toMatch(/role|button|submit/i);

      await sessionManager.delete(sessionId);
    });

    it('POST /sessions/:id/click returns 400 when description is missing', async () => {
      const createRes = await request(app).post('/sessions');
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.data.sessionId;
      cleanupIds.push(sessionId);

      const res = await request(app)
        .post(`/sessions/${sessionId}/click`)
        .send({});

      expect(res.status).toBe(400);

      await sessionManager.delete(sessionId);
    });

    // --- ACT-02: Type ---
    it('POST /sessions/:id/type fills the email input with value', async () => {
      const { sessionId } = await createSessionAndNavigate(app, FORM_HTML);
      cleanupIds.push(sessionId);

      const res = await request(app)
        .post(`/sessions/${sessionId}/type`)
        .send({ description: 'the email input', value: 'test@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.screenshot).toBe('string');
      expect(res.body.data.strategy).toMatch(/label|email/i);

      // Verify the value was actually set in the page
      const session = sessionManager.get(sessionId);
      expect(session).toBeDefined();
      const inputValue = await session!.page.locator('#email').inputValue();
      expect(inputValue).toBe('test@example.com');

      await sessionManager.delete(sessionId);
    });

    it('POST /sessions/:id/type returns 400 when description is missing', async () => {
      const createRes = await request(app).post('/sessions');
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.data.sessionId;
      cleanupIds.push(sessionId);

      const res = await request(app)
        .post(`/sessions/${sessionId}/type`)
        .send({ value: 'test' });

      expect(res.status).toBe(400);

      await sessionManager.delete(sessionId);
    });

    // --- ACT-03: Select ---
    // Use "country" as text match -- add a visible label so the finder can locate it.
    // The select element itself has id="country" and options with visible text.
    // The element finder's Strategy 3 (text match) or Strategy 4 (role) will need
    // to find it. Let's use a description that matches the select via text.
    it('POST /sessions/:id/select selects a dropdown option by label', async () => {
      const { sessionId } = await createSessionAndNavigate(app, FORM_HTML);
      cleanupIds.push(sessionId);

      // The select has id="country" but no label with "country" text.
      // Use the option text "United States" as a locator via text match,
      // then select from the parent <select>.
      // Actually, let's find the select by looking for visible text "United States"
      // and then use selectOption on its parent. But the finder finds elements, not
      // selects specifically. Let's add a label for the select in the HTML fixture.
      // For now, navigate to an improved HTML with a label for the select.
      const selectHtml = `data:text/html,${encodeURIComponent(
        '<form>' +
          '<label for="country">Country</label>' +
          '<select id="country"><option value="us">United States</option><option value="uk">United Kingdom</option></select>' +
          '</form>',
      )}`;
      await request(app)
        .post(`/sessions/${sessionId}/navigate`)
        .send({ url: selectHtml });

      const res = await request(app)
        .post(`/sessions/${sessionId}/select`)
        .send({ description: 'country', value: 'United Kingdom' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.screenshot).toBe('string');

      await sessionManager.delete(sessionId);
    });

    // --- ACT-04: Full screenshot ---
    it('POST /sessions/:id/screenshot/full returns full-page base64 screenshot', async () => {
      const { sessionId } = await createSessionAndNavigate(app, TALL_HTML);
      cleanupIds.push(sessionId);

      const res = await request(app)
        .post(`/sessions/${sessionId}/screenshot/full`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.screenshot).toBe('string');

      // Full page screenshot should be larger than a 400px thumbnail
      const decoded = Buffer.from(res.body.data.screenshot, 'base64');
      expect(decoded.length).toBeGreaterThan(1000);

      await sessionManager.delete(sessionId);
    });

    // --- ACT-05: Get text ---
    it('POST /sessions/:id/get_text returns text content from described element', async () => {
      const { sessionId } = await createSessionAndNavigate(app, FORM_HTML);
      cleanupIds.push(sessionId);

      // "Test Form" is the h1 text -- use text match description
      const res = await request(app)
        .post(`/sessions/${sessionId}/get_text`)
        .send({ description: 'Test Form' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.text).toContain('Test Form');
      expect(typeof res.body.data.screenshot).toBe('string');

      await sessionManager.delete(sessionId);
    });

    it('POST /sessions/:id/get_text returns 400 when description is missing', async () => {
      const createRes = await request(app).post('/sessions');
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.data.sessionId;
      cleanupIds.push(sessionId);

      const res = await request(app)
        .post(`/sessions/${sessionId}/get_text`)
        .send({});

      expect(res.status).toBe(400);

      await sessionManager.delete(sessionId);
    });

    // --- ACT-06: Wait ---
    it('POST /sessions/:id/wait with waitType element waits for described element', async () => {
      const { sessionId } = await createSessionAndNavigate(app, FORM_HTML);
      cleanupIds.push(sessionId);

      const res = await request(app)
        .post(`/sessions/${sessionId}/wait`)
        .send({ description: 'the submit button', waitType: 'element' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.screenshot).toBe('string');
      expect(res.body.data.waited).toBe('element');

      await sessionManager.delete(sessionId);
    });

    it('POST /sessions/:id/wait returns 400 for invalid waitType', async () => {
      const createRes = await request(app).post('/sessions');
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.data.sessionId;
      cleanupIds.push(sessionId);

      const res = await request(app)
        .post(`/sessions/${sessionId}/wait`)
        .send({ waitType: 'invalid' });

      expect(res.status).toBe(400);

      await sessionManager.delete(sessionId);
    });

    // --- ACT-07: Scroll ---
    it('POST /sessions/:id/scroll scrolls the page down', async () => {
      const { sessionId } = await createSessionAndNavigate(app, TALL_HTML);
      cleanupIds.push(sessionId);

      const res = await request(app)
        .post(`/sessions/${sessionId}/scroll`)
        .send({ direction: 'down', amount: 500 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.screenshot).toBe('string');
      expect(res.body.data.scrolled.direction).toBe('down');
      expect(res.body.data.scrolled.amount).toBe(500);

      await sessionManager.delete(sessionId);
    });

    // --- ACT-08: Verification screenshots on all actions ---
    it('every action returns a screenshot field in the response', async () => {
      const { sessionId } = await createSessionAndNavigate(app, FORM_HTML);
      cleanupIds.push(sessionId);

      // Navigate
      const navRes = await request(app)
        .post(`/sessions/${sessionId}/navigate`)
        .send({ url: SIMPLE_HTML });
      expect(typeof navRes.body.data.screenshot).toBe('string');

      // Navigate back to form for remaining actions
      await request(app)
        .post(`/sessions/${sessionId}/navigate`)
        .send({ url: FORM_HTML });

      // Click
      const clickRes = await request(app)
        .post(`/sessions/${sessionId}/click`)
        .send({ description: 'the submit button' });
      expect(typeof clickRes.body.data.screenshot).toBe('string');

      // Navigate back to form for remaining actions
      await request(app)
        .post(`/sessions/${sessionId}/navigate`)
        .send({ url: FORM_HTML });

      // Type
      const typeRes = await request(app)
        .post(`/sessions/${sessionId}/type`)
        .send({ description: 'the email input', value: 'a@b.com' });
      expect(typeof typeRes.body.data.screenshot).toBe('string');

      // Select -- use dedicated select HTML
      const selectHtml = `data:text/html,${encodeURIComponent(
        '<form><label for="country">Country</label>' +
          '<select id="country"><option value="us">United States</option></select></form>',
      )}`;
      await request(app)
        .post(`/sessions/${sessionId}/navigate`)
        .send({ url: selectHtml });
      const selectRes = await request(app)
        .post(`/sessions/${sessionId}/select`)
        .send({ description: 'country', value: 'United States' });
      expect(typeof selectRes.body.data.screenshot).toBe('string');

      // Get text
      await request(app)
        .post(`/sessions/${sessionId}/navigate`)
        .send({ url: FORM_HTML });
      const textRes = await request(app)
        .post(`/sessions/${sessionId}/get_text`)
        .send({ description: 'Test Form' });
      expect(typeof textRes.body.data.screenshot).toBe('string');

      // Wait
      const waitRes = await request(app)
        .post(`/sessions/${sessionId}/wait`)
        .send({ description: 'the submit button', waitType: 'element' });
      expect(typeof waitRes.body.data.screenshot).toBe('string');

      // Scroll (navigate to tall page)
      await request(app)
        .post(`/sessions/${sessionId}/navigate`)
        .send({ url: TALL_HTML });
      const scrollRes = await request(app)
        .post(`/sessions/${sessionId}/scroll`)
        .send({ direction: 'down', amount: 300 });
      expect(typeof scrollRes.body.data.screenshot).toBe('string');

      await sessionManager.delete(sessionId);
    });

    // --- Error cases: 404 for unknown session ---
    it('all actions return 404 for unknown sessionId', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const endpoints = [
        { path: `/sessions/${fakeId}/navigate`, body: { url: SIMPLE_HTML } },
        { path: `/sessions/${fakeId}/click`, body: { description: 'button' } },
        { path: `/sessions/${fakeId}/type`, body: { description: 'input', value: 'test' } },
        { path: `/sessions/${fakeId}/select`, body: { description: 'select', value: 'opt' } },
        { path: `/sessions/${fakeId}/screenshot/full`, body: {} },
        { path: `/sessions/${fakeId}/get_text`, body: { description: 'heading' } },
        { path: `/sessions/${fakeId}/wait`, body: { description: 'button', waitType: 'element' } },
        { path: `/sessions/${fakeId}/scroll`, body: { direction: 'down', amount: 500 } },
      ];

      for (const ep of endpoints) {
        const res = await request(app).post(ep.path).send(ep.body);
        expect(res.status, `Expected 404 for ${ep.path}`).toBe(404);
        expect(res.body.success).toBe(false);
      }
    });
  },
);
