import { describe, it, expect, beforeEach } from 'vitest';
import { ActionLogService } from '../src/services/actionLogService.js';

describe('ActionLogService', () => {
  let service: ActionLogService;

  // Use a fresh instance per test to avoid cross-test state leakage
  beforeEach(() => {
    service = new ActionLogService();
  });

  describe('append()', () => {
    it('creates a log entry with auto-generated ISO timestamp and sessionId', () => {
      const before = new Date().toISOString();
      service.append('sess-1', { action: 'click', status: 'success', durationMs: 50 });
      const after = new Date().toISOString();

      const logs = service.getLogs('sess-1');
      expect(logs).toHaveLength(1);

      const entry = logs[0];
      expect(entry.sessionId).toBe('sess-1');
      expect(entry.action).toBe('click');
      expect(entry.status).toBe('success');
      expect(entry.durationMs).toBe(50);
      // Timestamp should be a valid ISO string between before and after
      expect(entry.timestamp >= before).toBe(true);
      expect(entry.timestamp <= after).toBe(true);
    });

    it('appends multiple entries preserving order', () => {
      service.append('sess-1', { action: 'navigate', status: 'success' });
      service.append('sess-1', { action: 'click', status: 'fail', error: 'not found' });
      service.append('sess-1', { action: 'type', status: 'success', durationMs: 100 });

      const logs = service.getLogs('sess-1');
      expect(logs).toHaveLength(3);
      expect(logs[0].action).toBe('navigate');
      expect(logs[1].action).toBe('click');
      expect(logs[2].action).toBe('type');
    });

    it('stores entries per session independently', () => {
      service.append('sess-1', { action: 'click', status: 'success' });
      service.append('sess-2', { action: 'navigate', status: 'success' });

      expect(service.getLogs('sess-1')).toHaveLength(1);
      expect(service.getLogs('sess-2')).toHaveLength(1);
      expect(service.getLogs('sess-1')[0].action).toBe('click');
      expect(service.getLogs('sess-2')[0].action).toBe('navigate');
    });

    it('includes optional error field for failed actions', () => {
      service.append('sess-1', { action: 'click', status: 'fail', error: 'element not visible' });

      const logs = service.getLogs('sess-1');
      expect(logs[0].error).toBe('element not visible');
    });
  });

  describe('getLogs()', () => {
    it('returns empty array for unknown session', () => {
      const logs = service.getLogs('nonexistent');
      expect(logs).toEqual([]);
    });

    it('returns all entries for a known session', () => {
      service.append('sess-1', { action: 'click', status: 'success' });
      service.append('sess-1', { action: 'type', status: 'success' });

      const logs = service.getLogs('sess-1');
      expect(logs).toHaveLength(2);
    });
  });

  describe('clear()', () => {
    it('removes all entries for a session', () => {
      service.append('sess-1', { action: 'click', status: 'success' });
      service.append('sess-1', { action: 'type', status: 'success' });
      expect(service.getLogs('sess-1')).toHaveLength(2);

      service.clear('sess-1');

      expect(service.getLogs('sess-1')).toEqual([]);
    });

    it('does not affect other sessions', () => {
      service.append('sess-1', { action: 'click', status: 'success' });
      service.append('sess-2', { action: 'navigate', status: 'success' });

      service.clear('sess-1');

      expect(service.getLogs('sess-1')).toEqual([]);
      expect(service.getLogs('sess-2')).toHaveLength(1);
    });

    it('is a no-op for unknown session', () => {
      expect(() => service.clear('nonexistent')).not.toThrow();
    });
  });
});
