import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { launchBrowser, closeBrowser } from '../src/services/browserManager.js';
import { sessionManager } from '../src/services/sessionManager.js';

// Login form fixture: button is type="button" to prevent Playwright waiting for navigation
const LOGIN_FORM_HTML = `data:text/html,${encodeURIComponent(
  '<form>' +
    '<label for="username">Email</label>' +
    '<input type="email" id="username" placeholder="Enter your email">' +
    '<label for="password">Password</label>' +
    '<input type="password" id="password" placeholder="Enter password">' +
    '<button type="button" id="signInBtn">Submit</button>' +
    '</form>' +
    '<h1 id="result" style="display:none">Logged In</h1>' +
    '<script>' +
    'document.getElementById("signInBtn").addEventListener("click", function() {' +
    '  document.getElementById("result").style.display = "block";' +
    '});' +
    '</script>',
)}`;

// Multi-field form fixture for fill_form tests
const MULTI_FIELD_HTML = `data:text/html,${encodeURIComponent(
  '<form>' +
    '<label for="firstName">First Name</label>' +
    '<input type="text" id="firstName" placeholder="First name">' +
    '<label for="lastName">Last Name</label>' +
    '<input type="text" id="lastName" placeholder="Last name">' +
    '<label for="email">Email</label>' +
    '<input type="email" id="email" placeholder="Email address">' +
    '</form>',
)}`;

describe(
  'Compound routes',
  { timeout: 60_000 },
  () => {
    const app = createApp();
    const cleanupIds: string[] = [];

    beforeAll(async () => {
      await launchBrowser();
    });

    afterAll(async () => {
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

    // Helper to create a session (without navigating)
    async function createSession(): Promise<string> {
      const res = await request(app).post('/sessions');
      expect(res.status).toBe(201);
      const sessionId = res.body.data.sessionId;
      cleanupIds.push(sessionId);
      return sessionId;
    }

    // --- COMP-01: Login endpoint ---

    describe('POST /:sessionId/login', () => {
      it('returns 200 with screenshot, url, and steps array on successful login', async () => {
        const sessionId = await createSession();

        const res = await request(app)
          .post(`/sessions/${sessionId}/login`)
          .send({
            url: LOGIN_FORM_HTML,
            username: 'test@example.com',
            password: 'secret123',
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(typeof res.body.data.screenshot).toBe('string');
        expect(typeof res.body.data.url).toBe('string');
        expect(Array.isArray(res.body.data.steps)).toBe(true);
        expect(res.body.data.steps).toHaveLength(4);

        // Step names and statuses
        const stepNames = res.body.data.steps.map((s: { step: string }) => s.step);
        expect(stepNames).toEqual(['navigate', 'type_username', 'type_password', 'click_submit']);
        for (const step of res.body.data.steps) {
          expect(step.status).toBe('completed');
        }

        await sessionManager.delete(sessionId);
      });

      it('returns 400 when username is missing', async () => {
        const sessionId = await createSession();

        const res = await request(app)
          .post(`/sessions/${sessionId}/login`)
          .send({ url: LOGIN_FORM_HTML, password: 'secret' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);

        await sessionManager.delete(sessionId);
      });

      it('returns 400 when url is missing', async () => {
        const sessionId = await createSession();

        const res = await request(app)
          .post(`/sessions/${sessionId}/login`)
          .send({ username: 'test@example.com', password: 'secret' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);

        await sessionManager.delete(sessionId);
      });

      it('returns 404 for unknown sessionId', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';

        const res = await request(app)
          .post(`/sessions/${fakeId}/login`)
          .send({ url: LOGIN_FORM_HTML, username: 'test', password: 'secret' });

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
      });
    });

    // --- COMP-02: Fill form endpoint ---

    describe('POST /:sessionId/fill_form', () => {
      it('returns 200 with screenshot and filled fields on success', async () => {
        const sessionId = await createSession();

        // Navigate to the form first
        await request(app)
          .post(`/sessions/${sessionId}/navigate`)
          .send({ url: MULTI_FIELD_HTML });

        const res = await request(app)
          .post(`/sessions/${sessionId}/fill_form`)
          .send({
            fields: [
              { description: 'First Name', value: 'John' },
              { description: 'Last Name', value: 'Doe' },
              { description: 'Email', value: 'john@example.com' },
            ],
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(typeof res.body.data.screenshot).toBe('string');
        expect(Array.isArray(res.body.data.fields)).toBe(true);
        expect(res.body.data.fields).toHaveLength(3);

        for (const field of res.body.data.fields) {
          expect(field.status).toBe('completed');
          expect(typeof field.strategy).toBe('string');
          expect(typeof field.description).toBe('string');
        }

        await sessionManager.delete(sessionId);
      });

      it('actually sets input values in the page', async () => {
        const sessionId = await createSession();

        await request(app)
          .post(`/sessions/${sessionId}/navigate`)
          .send({ url: MULTI_FIELD_HTML });

        await request(app)
          .post(`/sessions/${sessionId}/fill_form`)
          .send({
            fields: [
              { description: 'First Name', value: 'Jane' },
              { description: 'Last Name', value: 'Smith' },
            ],
          });

        // Verify values were actually set in the page
        const session = sessionManager.get(sessionId);
        expect(session).toBeDefined();
        const firstName = await session!.page.locator('#firstName').inputValue();
        const lastName = await session!.page.locator('#lastName').inputValue();
        expect(firstName).toBe('Jane');
        expect(lastName).toBe('Smith');

        await sessionManager.delete(sessionId);
      });

      it('returns 400 for empty fields array', async () => {
        const sessionId = await createSession();

        const res = await request(app)
          .post(`/sessions/${sessionId}/fill_form`)
          .send({ fields: [] });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);

        await sessionManager.delete(sessionId);
      });

      it('returns 400 when fields is missing', async () => {
        const sessionId = await createSession();

        const res = await request(app)
          .post(`/sessions/${sessionId}/fill_form`)
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);

        await sessionManager.delete(sessionId);
      });

      it('returns 404 for unknown sessionId', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';

        const res = await request(app)
          .post(`/sessions/${fakeId}/fill_form`)
          .send({ fields: [{ description: 'test', value: 'val' }] });

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
      });
    });
  },
);
