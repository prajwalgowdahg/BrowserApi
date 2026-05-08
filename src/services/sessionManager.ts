import type { BrowserContext, Page } from 'playwright-core';
import { getBrowser } from './browserManager.js';
import { env } from '../config/env.js';
import { randomUUID } from 'node:crypto';
import { actionLogService } from './actionLogService.js';

export interface SessionData {
  id: string;
  context: BrowserContext;
  page: Page;
  lastActivity: number;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export class SessionManager {
  private sessions: Map<string, SessionData> = new Map();
  private timeoutMs: number;
  private maxSessions: number;
  private sweepInterval: ReturnType<typeof setInterval>;

  constructor(timeoutMs?: number, maxSessions?: number) {
    this.timeoutMs = timeoutMs ?? env.SESSION_TIMEOUT_MS;
    this.maxSessions = maxSessions ?? env.MAX_SESSIONS;

    // Sweep every 60 seconds for expired sessions
    this.sweepInterval = setInterval(() => this.sweep(), 60_000);
  }

  async create(): Promise<SessionData> {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error('Maximum concurrent sessions reached');
    }

    const browser = getBrowser();
    const context = await browser.newContext({
      viewport: { width: env.BROWSER_VIEWPORT_WIDTH, height: env.BROWSER_VIEWPORT_HEIGHT },
      locale: env.BROWSER_LOCALE,
      timezoneId: env.BROWSER_TIMEZONE,
      ...(env.BROWSER_USER_AGENT ? { userAgent: env.BROWSER_USER_AGENT } : {}),
      extraHTTPHeaders: {
        'Accept-Language': `${env.BROWSER_LOCALE},en;q=0.9`,
      },
    });
    const page = await context.newPage();
    const id = randomUUID();

    const timeoutHandle = setTimeout(() => {
      this.destroy(id);
    }, this.timeoutMs);

    // Prevent the timer from keeping the process alive
    if (timeoutHandle.unref) {
      timeoutHandle.unref();
    }

    const session: SessionData = {
      id,
      context,
      page,
      lastActivity: Date.now(),
      timeoutHandle,
    };

    this.sessions.set(id, session);
    return session;
  }

  get(sessionId: string): SessionData | undefined {
    return this.sessions.get(sessionId);
  }

  getOrThrow(sessionId: string): SessionData {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();
    clearTimeout(session.timeoutHandle);

    session.timeoutHandle = setTimeout(() => {
      this.destroy(sessionId);
    }, this.timeoutMs);

    if (session.timeoutHandle.unref) {
      session.timeoutHandle.unref();
    }
  }

  delete(sessionId: string): Promise<void> {
    return this.destroy(sessionId);
  }

  async destroy(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    clearTimeout(session.timeoutHandle);
    actionLogService.clear(sessionId);
    this.sessions.delete(sessionId);

    await session.context.close().catch(() => {});
  }

  get size(): number {
    return this.sessions.size;
  }

  sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity >= this.timeoutMs) {
        this.destroy(id);
      }
    }
  }

  async shutdown(): Promise<void> {
    clearInterval(this.sweepInterval);

    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      await this.destroy(id);
    }
  }
}

export const sessionManager = new SessionManager();
