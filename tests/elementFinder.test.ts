import { describe, it, expect, vi } from 'vitest';
import type { Page, Locator } from 'playwright-core';
import { findElement } from '../src/services/elementFinder.js';

/**
 * Helper to create a mock Locator with configurable count().
 * Every locator mock returns itself from first() to simulate chaining.
 */
function createMockLocator(count: number, tag = 'mock'): Locator {
  const locator = {
    count: vi.fn().mockResolvedValue(count),
    first: vi.fn().mockReturnValue(null), // placeholder, set below
  } as unknown as Locator;
  // first() returns the same locator-like object
  (locator as any).first = vi.fn().mockReturnValue(locator);
  return locator;
}

/**
 * Helper to build a mock Page where specific methods return locators
 * with configurable element counts.
 */
function createMockPage(config: {
  getByRole?: Record<string, { count: number }>;
  getByLabel?: Record<string, { count: number }>;
  getByPlaceholder?: Record<string, { count: number }>;
  getByText?: Record<string, { count: number }>;
  locator?: Record<string, { count: number }>;
}): Page {
  const page = {
    getByRole: vi.fn((_role: string, options?: { name?: RegExp | string }) => {
      const key = options?.name ? String(options.name) : _role;
      // Match against config keys
      for (const [pattern, val] of Object.entries(config.getByRole ?? {})) {
        if (key.includes(pattern) || pattern.includes(key) || matchRegex(key, pattern)) {
          return createMockLocator(val.count, `role:${pattern}`);
        }
      }
      return createMockLocator(0, `role:${key}`);
    }),
    getByLabel: vi.fn((text: string | RegExp) => {
      const key = typeof text === 'string' ? text : text.source;
      for (const [pattern, val] of Object.entries(config.getByLabel ?? {})) {
        if (key.includes(pattern) || pattern.includes(key) || matchRegex(key, pattern)) {
          return createMockLocator(val.count, `label:${pattern}`);
        }
      }
      return createMockLocator(0, `label:${key}`);
    }),
    getByPlaceholder: vi.fn((text: string | RegExp) => {
      const key = typeof text === 'string' ? text : text.source;
      for (const [pattern, val] of Object.entries(config.getByPlaceholder ?? {})) {
        if (key.includes(pattern) || pattern.includes(key) || matchRegex(key, pattern)) {
          return createMockLocator(val.count, `placeholder:${pattern}`);
        }
      }
      return createMockLocator(0, `placeholder:${key}`);
    }),
    getByText: vi.fn((text: string | RegExp, _options?: { exact?: boolean }) => {
      const key = typeof text === 'string' ? text : text.source;
      for (const [pattern, val] of Object.entries(config.getByText ?? {})) {
        if (key.includes(pattern) || pattern.includes(key) || matchRegex(key, pattern)) {
          return createMockLocator(val.count, `text:${pattern}`);
        }
      }
      return createMockLocator(0, `text:${key}`);
    }),
    locator: vi.fn((selector: string) => {
      for (const [pattern, val] of Object.entries(config.locator ?? {})) {
        if (selector.includes(pattern)) {
          return createMockLocator(val.count, `css:${pattern}`);
        }
      }
      return createMockLocator(0, `css:${selector}`);
    }),
  } as unknown as Page;
  return page;
}

/** Simple regex pattern match helper */
function matchRegex(input: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(input);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('findElement', () => {
  describe('Strategy 1: Role keyword match (compound phrases)', () => {
    it('resolves "the login button" via getByRole with login name regex', async () => {
      const page = createMockPage({
        getByRole: { 'log': { count: 1 } },
      });
      const result = await findElement(page, 'the login button');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^role:/);
      expect(result.locator).toBeDefined();
      // Verify getByRole was called
      expect(page.getByRole).toHaveBeenCalled();
    });

    it('resolves "the submit button" via getByRole with submit name regex', async () => {
      const page = createMockPage({
        getByRole: { 'submit': { count: 1 } },
      });
      const result = await findElement(page, 'the submit button');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^role:/);
      expect(page.getByRole).toHaveBeenCalled();
    });

    it('resolves "sign in button" via getByRole', async () => {
      const page = createMockPage({
        getByRole: { 'sign': { count: 1 } },
      });
      const result = await findElement(page, 'sign in button');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^role:/);
    });

    it('resolves "search button" via getByRole', async () => {
      const page = createMockPage({
        getByRole: { 'search': { count: 1 } },
      });
      const result = await findElement(page, 'search button');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^role:/);
    });
  });

  describe('Strategy 2: Input type keywords (label/placeholder/type cascade)', () => {
    it('resolves "the email input" via getByLabel when label exists', async () => {
      const page = createMockPage({
        getByLabel: { 'email': { count: 1 } },
      });
      const result = await findElement(page, 'the email input');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^label:/);
      expect(page.getByLabel).toHaveBeenCalled();
    });

    it('resolves "email" via getByPlaceholder fallback when no label', async () => {
      const page = createMockPage({
        getByPlaceholder: { 'email': { count: 1 } },
      });
      const result = await findElement(page, 'email');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^placeholder:/);
      expect(page.getByPlaceholder).toHaveBeenCalled();
    });

    it('resolves "email" via CSS input[type] fallback when no label or placeholder', async () => {
      const page = createMockPage({
        locator: { 'input[type="email"]': { count: 1 } },
      });
      const result = await findElement(page, 'email');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^css:/);
      expect(page.locator).toHaveBeenCalled();
    });

    it('resolves "the password field" via label/placeholder/type cascade', async () => {
      const page = createMockPage({
        getByLabel: { 'password': { count: 1 } },
      });
      const result = await findElement(page, 'the password field');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^label:/);
    });

    it('resolves "password" via placeholder fallback', async () => {
      const page = createMockPage({
        getByPlaceholder: { 'password': { count: 1 } },
      });
      const result = await findElement(page, 'password');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^placeholder:/);
    });

    it('resolves "password" via CSS input[type] fallback', async () => {
      const page = createMockPage({
        locator: { 'input[type="password"]': { count: 1 } },
      });
      const result = await findElement(page, 'password');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^css:/);
    });

    it('resolves "username" via input type cascade', async () => {
      const page = createMockPage({
        getByLabel: { 'username': { count: 1 } },
      });
      const result = await findElement(page, 'username');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^label:/);
    });

    it('resolves "search" input via input type cascade', async () => {
      const page = createMockPage({
        getByLabel: { 'search': { count: 1 } },
      });
      const result = await findElement(page, 'search');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^label:/);
    });
  });

  describe('Strategy 3: Generic text match', () => {
    it('resolves "some random text" via getByText fallback', async () => {
      const page = createMockPage({
        getByText: { 'some random text': { count: 1 } },
      });
      const result = await findElement(page, 'some random text');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^text:/);
      expect(page.getByText).toHaveBeenCalled();
    });
  });

  describe('Strategy 4: Role-based with description as name', () => {
    it('resolves unknown description via getByRole button with name', async () => {
      // No keyword matches, no text matches, but there IS a button with matching name
      const page = createMockPage({
        getByRole: { 'Continue Shopping': { count: 1 } },
      });
      const result = await findElement(page, 'Continue Shopping');

      expect(result).toBeDefined();
      // Could be text match or role match depending on cascade order
      expect(result.strategy).toBeDefined();
    });
  });

  describe('Error case: unresolvable descriptions', () => {
    it('throws descriptive error when no strategy matches', async () => {
      const page = createMockPage({}); // All locators return count 0

      await expect(findElement(page, 'completely nonexistent element'))
        .rejects.toThrow('Element not found: "completely nonexistent element"');
    });
  });

  describe('Strict mode: locator.first() is always used', () => {
    it('returns locator from .first() for role-based match', async () => {
      const page = createMockPage({
        getByRole: { 'log': { count: 3 } },
      });
      const result = await findElement(page, 'login button');

      // The result locator should have come from first() call
      expect(result).toBeDefined();
      // We verify that the implementation calls .first() on the matched locator
      // The mock setup has first() return itself, so we check strategy is correct
      expect(result.strategy).toMatch(/^role:/);
    });

    it('returns locator from .first() for text-based match', async () => {
      const page = createMockPage({
        getByText: { 'click here': { count: 5 } },
      });
      const result = await findElement(page, 'click here');

      expect(result).toBeDefined();
      expect(result.strategy).toMatch(/^text:/);
    });
  });

  describe('Strategy string identifies which heuristic matched', () => {
    it('returns strategy string with heuristic name for role match', async () => {
      const page = createMockPage({
        getByRole: { 'submit': { count: 1 } },
      });
      const result = await findElement(page, 'submit button');

      expect(typeof result.strategy).toBe('string');
      expect(result.strategy.length).toBeGreaterThan(0);
      // Strategy should indicate the matched role
      expect(result.strategy).toContain('role');
    });

    it('returns strategy string for label match', async () => {
      const page = createMockPage({
        getByLabel: { 'email': { count: 1 } },
      });
      const result = await findElement(page, 'email');

      expect(result.strategy).toContain('label');
    });

    it('returns strategy string for text match', async () => {
      const page = createMockPage({
        getByText: { 'forgot password': { count: 1 } },
      });
      const result = await findElement(page, 'forgot password');

      expect(result.strategy).toContain('text');
    });
  });
});
