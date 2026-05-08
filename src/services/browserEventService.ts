import type { Page } from 'playwright-core';

export type BrowserEventType = 'console' | 'pageerror' | 'requestfailed' | 'navigation';

export interface BrowserEvent {
  timestamp: string;
  sessionId: string;
  type: BrowserEventType;
  message: string;
  url?: string;
  method?: string;
  status?: string;
}

export class BrowserEventService {
  private events = new Map<string, BrowserEvent[]>();

  attach(sessionId: string, page: Page): void {
    page.on('console', (msg) => {
      this.append(sessionId, {
        type: 'console',
        message: msg.text(),
        url: msg.location().url || undefined,
      });
    });

    page.on('pageerror', (err) => {
      this.append(sessionId, {
        type: 'pageerror',
        message: err.message,
      });
    });

    page.on('requestfailed', (request) => {
      this.append(sessionId, {
        type: 'requestfailed',
        message: request.failure()?.errorText ?? 'request failed',
        url: request.url(),
        method: request.method(),
      });
    });

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        this.append(sessionId, {
          type: 'navigation',
          message: 'main frame navigated',
          url: frame.url(),
        });
      }
    });
  }

  append(sessionId: string, event: Omit<BrowserEvent, 'timestamp' | 'sessionId'>): void {
    if (!this.events.has(sessionId)) {
      this.events.set(sessionId, []);
    }
    const next = {
      ...event,
      sessionId,
      timestamp: new Date().toISOString(),
    };
    const list = this.events.get(sessionId)!;
    list.push(next);
    if (list.length > 500) list.splice(0, list.length - 500);
  }

  getEvents(sessionId: string, type?: BrowserEventType): BrowserEvent[] {
    const events = this.events.get(sessionId) ?? [];
    return type ? events.filter((event) => event.type === type) : events;
  }

  clear(sessionId: string): void {
    this.events.delete(sessionId);
  }
}

export const browserEventService = new BrowserEventService();
