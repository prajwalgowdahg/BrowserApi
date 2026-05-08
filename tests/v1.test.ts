import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { launchBrowser, closeBrowser } from '../src/services/browserManager.js';
import { sessionManager } from '../src/services/sessionManager.js';

describe(
  'v1 platform API',
  { timeout: 60_000 },
  () => {
    const app = createApp();

    beforeAll(async () => {
      await launchBrowser();
    });

    afterAll(async () => {
      await sessionManager.shutdown();
      await closeBrowser();
    });

    it('POST /v1/tasks/run executes a web.extract task with v1 envelope', async () => {
      const url = `data:text/html,${encodeURIComponent('<h1>Lead List</h1><a href="/a">Acme</a>')}`;

      const res = await request(app)
        .post('/v1/tasks/run')
        .send({
          type: 'web.extract',
          input: { url },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('web.extract');
      expect(res.body.data.status).toBe('completed');
      expect(res.body.meta.taskId).toBe(res.body.data.id);
      expect(res.body.meta.status).toBe('completed');
      expect(res.body.data.result.text).toContain('Lead List');
    });

    it('GET /v1/tasks/:taskId/events and artifacts return persisted task data', async () => {
      const url = `data:text/html,${encodeURIComponent('<h1>Artifact Page</h1>')}`;
      const runRes = await request(app)
        .post('/v1/tasks/run')
        .send({ type: 'web.extract', input: { url } });

      const taskId = runRes.body.data.id;
      const eventsRes = await request(app).get(`/v1/tasks/${taskId}/events`);
      const artifactsRes = await request(app).get(`/v1/tasks/${taskId}/artifacts`);

      expect(eventsRes.status).toBe(200);
      expect(eventsRes.body.success).toBe(true);
      expect(eventsRes.body.data.events.length).toBeGreaterThan(0);
      expect(artifactsRes.status).toBe(200);
      expect(artifactsRes.body.data.artifacts.length).toBeGreaterThan(0);
    });

    it('policy-gated tasks return needs_approval instead of bypassing sensitive steps', async () => {
      const res = await request(app)
        .post('/v1/tasks/run')
        .send({
          type: 'shopping.product_select',
          input: { size: '32', action: 'checkout and pay' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('needs_approval');
      expect(res.body.data.error.errorCode).toBe('APPROVAL_REQUIRED');
    });

    it('usecase route /v1/extract maps to a web.extract task', async () => {
      const url = `data:text/html,${encodeURIComponent('<p>Extract me</p>')}`;
      const res = await request(app)
        .post('/v1/extract')
        .send({ url });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('web.extract');
      expect(res.body.data.result.text).toContain('Extract me');
    });

    it('GET /v1/openapi.json returns a public API spec', async () => {
      const res = await request(app).get('/v1/openapi.json');

      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
      expect(res.body.paths['/v1/tasks/run']).toBeDefined();
    });
  },
);

