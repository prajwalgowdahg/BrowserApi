import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { launchBrowser, closeBrowser } from '../src/services/browserManager.js';
import { sessionManager } from '../src/services/sessionManager.js';

describe(
  'Screenshot route',
  { timeout: 30_000 },
  () => {
    const app = createApp();

    beforeAll(async () => {
      await launchBrowser();
    });

    afterAll(async () => {
      await sessionManager.shutdown();
      await closeBrowser();
    });

    it('GET /sessions/:sessionId/screenshot returns 200 with base64 screenshot', async () => {
      // Create a session
      const createRes = await request(app).post('/sessions');
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.data.sessionId;

      // Navigate to a page so we have content to screenshot
      const session = sessionManager.get(sessionId);
      expect(session).toBeDefined();
      await session!.page.goto('data:text/html,<h1>Test</h1>');

      // Request screenshot
      const res = await request(app).get(`/sessions/${sessionId}/screenshot`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.screenshot).toBeDefined();
      expect(typeof res.body.data.screenshot).toBe('string');
      expect(res.body.data.screenshot.length).toBeGreaterThan(0);

      // Verify it's valid base64
      const decoded = Buffer.from(res.body.data.screenshot, 'base64');
      expect(decoded.length).toBeGreaterThan(0);

      // Cleanup
      await sessionManager.delete(sessionId);
    });

    it('GET /sessions/:sessionId/screenshot returns 404 for unknown session', async () => {
      const res = await request(app).get(
        '/sessions/00000000-0000-0000-0000-000000000000/screenshot',
      );
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Session not found');
    });
  },
);
