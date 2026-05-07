import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { launchBrowser, closeBrowser } from '../src/services/browserManager.js';
import { sessionManager } from '../src/services/sessionManager.js';
import { env } from '../src/config/env.js';

describe(
  'Session routes',
  { timeout: 30_000 },
  () => {
    const app = createApp();
    const createdSessionIds: string[] = [];

    beforeAll(async () => {
      await launchBrowser();
    });

    afterAll(async () => {
      await sessionManager.shutdown();
      await closeBrowser();
    });

    it('POST /sessions returns 201 with sessionId', async () => {
      const res = await request(app).post('/sessions');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sessionId).toBeDefined();
      expect(res.body.data.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      // Cleanup
      createdSessionIds.push(res.body.data.sessionId);
      await sessionManager.delete(res.body.data.sessionId);
    });

    it('POST /sessions creates an active browser context', async () => {
      const res = await request(app).post('/sessions');
      expect(res.status).toBe(201);

      const sessionId = res.body.data.sessionId;
      const session = sessionManager.get(sessionId);
      expect(session).toBeDefined();

      // Navigate to a data URL to prove the context is live
      await session!.page.goto('data:text/html,<h1>Hello</h1>');
      const title = await session!.page.title();
      expect(title).toBe('');

      // Cleanup
      await sessionManager.delete(sessionId);
    });

    it('DELETE /sessions/:sessionId returns 200 with deleted:true', async () => {
      // Create a session first
      const createRes = await request(app).post('/sessions');
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.data.sessionId;

      // Delete it
      const deleteRes = await request(app).delete(`/sessions/${sessionId}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      expect(deleteRes.body.data.deleted).toBe(true);

      // Verify it's gone from the manager
      expect(sessionManager.get(sessionId)).toBeUndefined();
    });

    it('DELETE /sessions/:sessionId returns 404 for unknown id', async () => {
      const res = await request(app).delete(
        '/sessions/00000000-0000-0000-0000-000000000000',
      );
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Session not found');
    });

    it('POST /sessions returns 429 at capacity', { timeout: 60_000 }, async () => {
      const maxSessions = env.MAX_SESSIONS;
      const sessionIds: string[] = [];

      // Fill to capacity
      for (let i = 0; i < maxSessions; i++) {
        const res = await request(app).post('/sessions');
        expect(res.status).toBe(201);
        sessionIds.push(res.body.data.sessionId);
      }

      // The next one should be rejected
      const overCapacityRes = await request(app).post('/sessions');
      expect(overCapacityRes.status).toBe(429);
      expect(overCapacityRes.body.success).toBe(false);
      expect(overCapacityRes.body.error).toContain('Maximum concurrent sessions');

      // Cleanup all sessions
      for (const id of sessionIds) {
        await sessionManager.delete(id);
      }
    });

    it('Session state persists across requests (cookie isolation)', async () => {
      // Create a session
      const createRes = await request(app).post('/sessions');
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.data.sessionId;

      const session = sessionManager.get(sessionId);
      expect(session).toBeDefined();

      // Set a cookie via the browser context
      await session!.context.addCookies([
        {
          name: 'test-cookie',
          value: 'session-isolated',
          domain: 'example.com',
          path: '/',
        },
      ]);

      // Verify the cookie persists in the context
      const cookies = await session!.context.cookies('https://example.com');
      expect(cookies).toHaveLength(1);
      expect(cookies[0].name).toBe('test-cookie');
      expect(cookies[0].value).toBe('session-isolated');

      // Verify cookies persist across multiple requests in the same session
      // This proves the BrowserContext maintains isolated state
      const cookiesAfter =
        await session!.context.cookies('https://example.com');
      expect(cookiesAfter).toHaveLength(1);
      expect(cookiesAfter[0].value).toBe('session-isolated');

      // Cleanup
      await sessionManager.delete(sessionId);
    });

    it('GET /sessions/:sessionId/logs returns action history', async () => {
      // Create a session
      const createRes = await request(app).post('/sessions');
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.data.sessionId;

      // Perform a navigate action using data URL
      const navRes = await request(app)
        .post(`/sessions/${sessionId}/navigate`)
        .send({ url: 'data:text/html,<h1>Test</h1>' });
      expect(navRes.status).toBe(200);

      // Get logs
      const logsRes = await request(app).get(`/sessions/${sessionId}/logs`);
      expect(logsRes.status).toBe(200);
      expect(logsRes.body.success).toBe(true);
      expect(logsRes.body.data.logs).toBeDefined();
      expect(Array.isArray(logsRes.body.data.logs)).toBe(true);

      // Should have at least session.create + navigate entries
      const logs = logsRes.body.data.logs;
      expect(logs.length).toBeGreaterThanOrEqual(2);

      // Verify navigate entry
      const navEntry = logs.find((l: any) => l.action === 'navigate');
      expect(navEntry).toBeDefined();
      expect(navEntry.status).toBe('success');
      expect(navEntry.sessionId).toBe(sessionId);
      expect(navEntry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Cleanup
      await sessionManager.delete(sessionId);
    });

    it('GET /sessions/:sessionId/logs returns 404 for unknown session', async () => {
      const res = await request(app).get(
        '/sessions/00000000-0000-0000-0000-000000000000/logs',
      );
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Session not found');
    });

    it('Logs include session.create entry', async () => {
      // Create a session
      const createRes = await request(app).post('/sessions');
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.data.sessionId;

      // Get logs immediately after creation
      const logsRes = await request(app).get(`/sessions/${sessionId}/logs`);
      expect(logsRes.status).toBe(200);

      const logs = logsRes.body.data.logs;
      expect(logs.length).toBeGreaterThanOrEqual(1);

      // First entry should be session.create
      expect(logs[0].action).toBe('session.create');
      expect(logs[0].status).toBe('success');

      // Cleanup
      await sessionManager.delete(sessionId);
    });
  },
);
