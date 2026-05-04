import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Locator } from 'playwright-core';
import { findElementWithAI, ElementNotFoundError } from '../src/services/cascadeFinder.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindElement = vi.fn();
vi.mock('../src/services/elementFinder.js', () => ({
  findElement: (...args: any[]) => mockFindElement(...args),
}));

const mockFindByA11yTree = vi.fn();
const mockFindByVision = vi.fn();
vi.mock('../src/services/aiElementFinder.js', () => ({
  findByA11yTree: (...args: any[]) => mockFindByA11yTree(...args),
  findByVision: (...args: any[]) => mockFindByVision(...args),
}));

const mockScreenshotPage = vi.fn();
vi.mock('../src/utils/thumbnails.js', () => ({
  screenshotPage: (...args: any[]) => mockScreenshotPage(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLocator(): Locator {
  const locator = {
    count: vi.fn().mockResolvedValue(1),
    first: vi.fn(),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
  } as unknown as Locator;
  (locator as any).first = vi.fn().mockReturnValue(locator);
  return locator;
}

function createMockPage(): Page {
  return {
    mouse: { click: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Page;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cascadeFinder', () => {
  const mockPage = createMockPage();
  const mockLocator = createMockLocator();

  beforeEach(() => {
    mockFindElement.mockReset();
    mockFindByA11yTree.mockReset();
    mockFindByVision.mockReset();
    mockScreenshotPage.mockReset();
  });

  describe('findElementWithAI - cascade behavior', () => {
    it('returns Layer 1 result immediately when heuristics succeed (no AI calls)', async () => {
      const layer1Result = { locator: mockLocator, strategy: 'role:login button' };
      mockFindElement.mockResolvedValue(layer1Result);

      const result = await findElementWithAI(mockPage, 'login button');

      expect(result).toEqual(layer1Result);
      expect(mockFindElement).toHaveBeenCalledWith(mockPage, 'login button');
      expect(mockFindByA11yTree).not.toHaveBeenCalled();
      expect(mockFindByVision).not.toHaveBeenCalled();
    });

    it('tries Layer 2 when Layer 1 throws, returns Layer 2 result when it succeeds', async () => {
      mockFindElement.mockRejectedValue(new Error('Element not found: "email input"'));
      const layer2Result = {
        locator: mockLocator,
        strategy: 'ai-a11y:label',
        confidence: 0.85,
      };
      mockFindByA11yTree.mockResolvedValue(layer2Result);

      const result = await findElementWithAI(mockPage, 'email input');

      expect(result).toEqual({
        locator: mockLocator,
        strategy: 'ai-a11y:label',
        confidence: 0.85,
      });
      expect(mockFindByA11yTree).toHaveBeenCalledWith(mockPage, 'email input');
      expect(mockFindByVision).not.toHaveBeenCalled();
    });

    it('tries Layer 3 when Layer 2 returns null (low confidence or no match)', async () => {
      mockFindElement.mockRejectedValue(new Error('Element not found: "submit"'));
      mockFindByA11yTree.mockResolvedValue(null);
      const layer3Result = {
        locator: mockLocator,
        strategy: 'ai-vision:(250,400)',
        confidence: 0.92,
        clickedAt: { x: 250, y: 400 },
      };
      mockFindByVision.mockResolvedValue(layer3Result);

      const result = await findElementWithAI(mockPage, 'submit');

      expect(result).toEqual({
        locator: mockLocator,
        strategy: 'ai-vision:(250,400)',
        confidence: 0.92,
        clickedAt: { x: 250, y: 400 },
      });
      expect(mockFindByVision).toHaveBeenCalledWith(mockPage, 'submit');
    });

    it('returns Layer 3 result when confidence >= threshold', async () => {
      mockFindElement.mockRejectedValue(new Error('Element not found'));
      mockFindByA11yTree.mockResolvedValue(null);
      const layer3Result = {
        locator: mockLocator,
        strategy: 'ai-vision:(100,200)',
        confidence: 0.75,
        clickedAt: { x: 100, y: 200 },
      };
      mockFindByVision.mockResolvedValue(layer3Result);

      const result = await findElementWithAI(mockPage, 'some element');

      expect(result).toEqual({
        locator: mockLocator,
        strategy: 'ai-vision:(100,200)',
        confidence: 0.75,
        clickedAt: { x: 100, y: 200 },
      });
    });

    it('throws ElementNotFoundError with screenshot and diagnostics when all 3 layers fail', async () => {
      mockFindElement.mockRejectedValue(new Error('Element not found: "mystery button"'));
      mockFindByA11yTree.mockResolvedValue(null);
      mockFindByVision.mockResolvedValue(null);
      mockScreenshotPage.mockResolvedValue('base64screenshotdata');

      await expect(findElementWithAI(mockPage, 'mystery button'))
        .rejects.toThrow(ElementNotFoundError);

      try {
        await findElementWithAI(mockPage, 'mystery button');
      } catch (err) {
        const error = err as ElementNotFoundError;
        expect(error).toBeInstanceOf(ElementNotFoundError);
        expect(error.description).toBe('mystery button');
        expect(error.screenshot).toBe('base64screenshotdata');
        expect(error.diagnostics).toHaveLength(3);
      }
    });

    it('ElementNotFoundError contains diagnostic info for each layer tried', async () => {
      mockFindElement.mockRejectedValue(new Error('Element not found: "x"'));
      mockFindByA11yTree.mockRejectedValue(new Error('AI timeout'));
      mockFindByVision.mockResolvedValue(null);
      mockScreenshotPage.mockResolvedValue('screenshot');

      try {
        await findElementWithAI(mockPage, 'x');
      } catch (err) {
        const error = err as ElementNotFoundError;
        expect(error.diagnostics[0]).toEqual({
          layer: 1,
          name: 'heuristic',
          error: 'Element not found: "x"',
        });
        expect(error.diagnostics[1]).toEqual({
          layer: 2,
          name: 'a11y-tree',
          error: 'AI timeout',
        });
        expect(error.diagnostics[2]).toEqual({
          layer: 3,
          name: 'vision',
          reason: 'no result',
        });
      }
    });

    it('ElementNotFoundError.screenshot is a base64 string from screenshotPage()', async () => {
      mockFindElement.mockRejectedValue(new Error('fail'));
      mockFindByA11yTree.mockResolvedValue(null);
      mockFindByVision.mockResolvedValue(null);
      mockScreenshotPage.mockResolvedValue('abc123base64');

      try {
        await findElementWithAI(mockPage, 'test');
      } catch (err) {
        expect((err as ElementNotFoundError).screenshot).toBe('abc123base64');
        expect(mockScreenshotPage).toHaveBeenCalledWith(mockPage);
      }
    });

    it('when Layer 3 (vision) returns a result with clickedAt coordinates, the result includes those coordinates', async () => {
      mockFindElement.mockRejectedValue(new Error('not found'));
      mockFindByA11yTree.mockResolvedValue(null);
      mockFindByVision.mockResolvedValue({
        locator: mockLocator,
        strategy: 'ai-vision:(320,480)',
        confidence: 0.88,
        clickedAt: { x: 320, y: 480 },
      });

      const result = await findElementWithAI(mockPage, 'buy now button');

      expect(result.clickedAt).toEqual({ x: 320, y: 480 });
      expect(result.strategy).toBe('ai-vision:(320,480)');
    });
  });
});
