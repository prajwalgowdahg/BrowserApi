import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app.js';
import { notFoundHandler } from '../src/middleware/notFound.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { ElementNotFoundError } from '../src/services/cascadeFinder.js';

describe('Error handling', () => {
  const app = createApp();

  describe('404 handling', () => {
    it('GET /nonexistent returns 404 with JSON error', async () => {
      const res = await request(app).get('/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: 'Not found' });
    });

    it('POST /nonexistent returns 404 with JSON error', async () => {
      const res = await request(app).post('/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: 'Not found' });
    });

    it('returns application/json, not text/html', async () => {
      const res = await request(app).get('/does-not-exist');

      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('response does NOT contain HTML tags', async () => {
      const res = await request(app).get('/does-not-exist');
      const body = JSON.stringify(res.body);

      expect(body).not.toContain('<!DOCTYPE');
      expect(body).not.toContain('<html');
    });
  });

  describe('Async error handling (ERR-04)', () => {
    it('async handler that throws returns 500 JSON error', async () => {
      // Build a custom app with the test route registered BEFORE 404 and error handlers
      const testApp = express();
      testApp.use(express.json());
      testApp.get('/test-async-error', async () => {
        throw new Error('Test async error');
      });
      testApp.use(notFoundHandler);
      testApp.use(errorHandler);

      const res = await request(testApp).get('/test-async-error');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'Test async error' });
    });
  });

  describe('ERR-02: ElementNotFoundError screenshot enrichment', () => {
    it('ElementNotFoundError response includes screenshot field', async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.get('/test-element-not-found', (req, res, next) => {
        next(new ElementNotFoundError('the login button', [], 'fake-screenshot-base64'));
      });
      testApp.use(notFoundHandler);
      testApp.use(errorHandler);

      const res = await request(testApp).get('/test-element-not-found');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('the login button');
      expect(res.body.screenshot).toBe('fake-screenshot-base64');
    });

    it('regular Error response does NOT include screenshot field', async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.get('/test-regular-error', (req, res, next) => {
        next(new Error('Something went wrong'));
      });
      testApp.use(notFoundHandler);
      testApp.use(errorHandler);

      const res = await request(testApp).get('/test-regular-error');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'Something went wrong' });
      expect(res.body).not.toHaveProperty('screenshot');
    });
  });

  describe('Server stability', () => {
    it('multiple sequential errors do not crash the server', async () => {
      const results = await Promise.all([
        request(app).get('/nonexistent-1'),
        request(app).get('/nonexistent-2'),
        request(app).get('/nonexistent-3'),
      ]);

      for (const res of results) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false, error: 'Not found' });
      }
    });
  });
});
