import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getApp } from './setup.js';

describe('GET /health', () => {
  const app = getApp();

  it('returns 200 with { success: true, data: { status: "ok" } }', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
  });

  it('returns application/json content-type', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('has success and data properties in response body', async () => {
    const res = await request(app).get('/health');

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('status', 'ok');
  });
});
