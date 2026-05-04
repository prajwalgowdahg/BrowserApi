import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Response format contract', () => {
  const app = createApp();

  it('success responses have shape { success: true, data: <value> }', async () => {
    const res = await request(app).get('/health');

    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('data');
    expect(typeof res.body.data).toBe('object');
  });

  it('error responses have shape { success: false, error: <string> }', async () => {
    const res = await request(app).get('/nonexistent');

    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
  });

  it('error responses never have a data property', async () => {
    const res = await request(app).get('/nonexistent');

    expect(res.body).not.toHaveProperty('data');
  });

  it('success responses never have an error property', async () => {
    const res = await request(app).get('/health');

    expect(res.body).not.toHaveProperty('error');
  });

  it('health check matches exact response contract', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ success: true, data: { status: 'ok' } });
  });
});
