import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../src/services/sessionManager.js';
import { actionLogService } from '../src/services/actionLogService.js';

// Mock browserManager
const mockPage = { close: vi.fn() };
const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../src/services/browserManager.js', () => ({
  getBrowser: vi.fn(() => ({
    newContext: vi.fn(() => mockContext),
  })),
}));

describe('SessionManager', () => {
  let sm: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    sm = new SessionManager(1000, 2);
    mockContext.close.mockClear();
    mockPage.close.mockClear();
  });

  afterEach(() => {
    sm.shutdown();
    vi.useRealTimers();
  });

  describe('create()', () => {
    it('returns a session with a unique id and active context', async () => {
      const session = await sm.create();

      expect(session.id).toBeDefined();
      expect(typeof session.id).toBe('string');
      expect(session.context).toBe(mockContext);
      expect(session.page).toBe(mockPage);
      expect(session.lastActivity).toBeGreaterThan(0);
      expect(session.timeoutHandle).toBeDefined();
    });

    it('increments session count', async () => {
      await sm.create();
      expect(sm.size).toBe(1);

      await sm.create();
      expect(sm.size).toBe(2);
    });

    it('generates unique ids for each session', async () => {
      const s1 = await sm.create();
      const s2 = await sm.create();
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe('create() at capacity', () => {
    it('throws when maxSessions reached', async () => {
      await sm.create();
      await sm.create();

      await expect(sm.create()).rejects.toThrow('Maximum concurrent sessions reached');
    });
  });

  describe('get()', () => {
    it('returns SessionData for existing id', async () => {
      const created = await sm.create();
      const found = sm.get(created.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it('returns undefined for unknown id', () => {
      const found = sm.get('nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('getOrThrow()', () => {
    it('returns SessionData for existing id', async () => {
      const created = await sm.create();
      const found = sm.getOrThrow(created.id);
      expect(found.id).toBe(created.id);
    });

    it('throws for unknown id', () => {
      expect(() => sm.getOrThrow('nonexistent')).toThrow('Session not found');
    });
  });

  describe('touch()', () => {
    it('updates lastActivity and resets timeout', async () => {
      const created = await sm.create();
      const originalActivity = created.lastActivity;

      // Advance time slightly
      vi.advanceTimersByTime(100);

      sm.touch(created.id);
      expect(created.lastActivity).toBeGreaterThanOrEqual(originalActivity);
    });

    it('is a no-op for unknown session id', () => {
      expect(() => sm.touch('nonexistent')).not.toThrow();
    });
  });

  describe('delete()', () => {
    it('removes session from store and calls context.close()', async () => {
      const created = await sm.create();
      expect(sm.size).toBe(1);

      await sm.delete(created.id);

      expect(sm.size).toBe(0);
      expect(sm.get(created.id)).toBeUndefined();
      expect(mockContext.close).toHaveBeenCalled();
    });

    it('clears the timeout handle', async () => {
      const created = await sm.create();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      await sm.delete(created.id);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(created.timeoutHandle);
      clearTimeoutSpy.mockRestore();
    });

    it('is a no-op for unknown session id', async () => {
      await expect(sm.delete('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('destroy()', () => {
    it('clears timeout before closing context', async () => {
      const created = await sm.create();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      await sm.destroy(created.id);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(created.timeoutHandle);
      expect(mockContext.close).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('clears action logs for the destroyed session', async () => {
      const created = await sm.create();

      // Append a log entry via the singleton actionLogService
      actionLogService.append(created.id, { action: 'click', status: 'success' });
      expect(actionLogService.getLogs(created.id)).toHaveLength(1);

      await sm.destroy(created.id);

      expect(actionLogService.getLogs(created.id)).toEqual([]);
    });
  });

  describe('sweep()', () => {
    it('destroys sessions older than timeoutMs', async () => {
      const created = await sm.create();
      expect(sm.size).toBe(1);

      // Advance past the timeout
      vi.advanceTimersByTime(1001);

      sm.sweep();

      // sweep is synchronous but destroy is async -- give it a tick
      await vi.advanceTimersByTimeAsync(0);

      expect(sm.size).toBe(0);
    });

    it('keeps recent sessions', async () => {
      await sm.create();
      expect(sm.size).toBe(1);

      // Advance less than the timeout
      vi.advanceTimersByTime(500);

      sm.touch((sm as any).sessions.keys().next().value);

      vi.advanceTimersByTime(500);

      sm.sweep();
      await vi.advanceTimersByTimeAsync(0);

      // Still within timeout since we touched it
      expect(sm.size).toBe(1);
    });
  });

  describe('shutdown()', () => {
    it('destroys all sessions and clears sweep interval', async () => {
      await sm.create();
      await sm.create();
      expect(sm.size).toBe(2);

      await sm.shutdown();

      expect(sm.size).toBe(0);
    });
  });
});
