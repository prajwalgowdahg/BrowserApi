/**
 * In-memory per-session action log storage.
 * Entries are appended on every action and cleared when a session is destroyed.
 */

export interface LogEntry {
  timestamp: string;   // ISO 8601
  sessionId: string;
  action: string;
  status: 'success' | 'fail';
  error?: string;
  durationMs?: number;
}

export class ActionLogService {
  private logs: Map<string, LogEntry[]> = new Map();

  append(sessionId: string, entry: Omit<LogEntry, 'timestamp' | 'sessionId'>): void {
    if (!this.logs.has(sessionId)) {
      this.logs.set(sessionId, []);
    }
    this.logs.get(sessionId)!.push({
      ...entry,
      sessionId,
      timestamp: new Date().toISOString(),
    });
  }

  getLogs(sessionId: string): LogEntry[] {
    return this.logs.get(sessionId) ?? [];
  }

  clear(sessionId: string): void {
    this.logs.delete(sessionId);
  }
}

export const actionLogService = new ActionLogService();
