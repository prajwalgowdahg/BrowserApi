import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Locator } from 'playwright-core';
import { findByA11yTree, findByVision, CONFIDENCE_THRESHOLD, MAX_SNAPSHOT_CHARS } from '../src/services/aiElementFinder.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock AI client with controllable completions
const mockCreate = vi.fn();
vi.mock('../src/services/aiClient.js', () => ({
  getAIClient: () => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }),
  getDeploymentName: () => 'gpt-4o',
}));

// Mock env to have valid Azure config
vi.mock('../src/config/env.js', () => ({
  get env() {
    return {
      NODE_ENV: 'test',
      PORT: 3000,
      AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'test-key',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o',
      AZURE_OPENAI_API_VERSION: '2024-07-01-preview',
    };
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLocator(count: number): Locator {
  const locator = {
    count: vi.fn().mockResolvedValue(count),
    first: vi.fn().mockReturnValue(null),
  } as unknown as Locator;
  (locator as any).first = vi.fn().mockReturnValue(locator);
  return locator;
}

function createMockPage(config: {
  ariaSnapshot?: string;
  screenshotBuffer?: Buffer;
  viewportSize?: { width: number; height: number };
  locatorCount?: number;
}): Page {
  const mockLocator = createMockLocator(config.locatorCount ?? 1);
  return {
    ariaSnapshot: vi.fn().mockResolvedValue(config.ariaSnapshot ?? '- button "Login"'),
    screenshot: vi.fn().mockResolvedValue(config.screenshotBuffer ?? Buffer.from('fake-jpeg')),
    viewportSize: vi.fn().mockReturnValue(config.viewportSize ?? { width: 1280, height: 720 }),
    locator: vi.fn().mockReturnValue(mockLocator),
    getByRole: vi.fn().mockReturnValue(mockLocator),
    getByText: vi.fn().mockReturnValue(mockLocator),
    getByLabel: vi.fn().mockReturnValue(mockLocator),
    getByTestId: vi.fn().mockReturnValue(mockLocator),
  } as unknown as Page;
}

/** Build a mock AI response for a11y tree queries. */
function mockA11yResponse(selector: string, strategy: string, confidence: number, reasoning = 'Match found') {
  return {
    choices: [{
      message: {
        content: JSON.stringify({ selector, strategy, confidence, reasoning }),
      },
    }],
  };
}

/** Build a mock AI response for vision queries. */
function mockVisionResponse(x: number, y: number, confidence: number, description = 'Element found') {
  return {
    choices: [{
      message: {
        content: JSON.stringify({ x, y, confidence, description }),
      },
    }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('aiElementFinder', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('Layer 2: findByA11yTree', () => {
    it('captures ariaSnapshot from page, sends to GPT-4o, returns locator when confidence >= 0.7', async () => {
      const page = createMockPage({
        ariaSnapshot: '- button "Login"\n- textbox "Email"',
        locatorCount: 1,
      });
      mockCreate.mockResolvedValue(mockA11yResponse('Login', 'role', 0.85, 'Button with Login text'));

      const result = await findByA11yTree(page, 'the login button');

      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(0.85);
      expect(result!.strategy).toContain('ai-a11y');
      expect(page.ariaSnapshot).toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('returns null when confidence < 0.7 (below threshold)', async () => {
      const page = createMockPage({
        ariaSnapshot: '- button "Submit"',
        locatorCount: 1,
      });
      mockCreate.mockResolvedValue(mockA11yResponse('Submit', 'role', 0.5, 'Uncertain match'));

      const result = await findByA11yTree(page, 'the submit button');

      expect(result).toBeNull();
    });

    it('returns null when AI-returned selector matches 0 elements (locator.count() === 0)', async () => {
      const page = createMockPage({
        ariaSnapshot: '- heading "Welcome"',
        locatorCount: 0, // No elements match the AI selector
      });
      mockCreate.mockResolvedValue(mockA11yResponse('nonexistent-element', 'css', 0.9, 'Best guess'));

      const result = await findByA11yTree(page, 'something that does not exist');

      expect(result).toBeNull();
    });

    it('truncates a11y snapshot to MAX_SNAPSHOT_CHARS when too large', async () => {
      const longSnapshot = 'x'.repeat(MAX_SNAPSHOT_CHARS + 5000);
      const page = createMockPage({
        ariaSnapshot: longSnapshot,
        locatorCount: 1,
      });
      mockCreate.mockResolvedValue(mockA11yResponse('btn', 'css', 0.8));

      await findByA11yTree(page, 'a button');

      // Verify the snapshot sent to AI was truncated
      const callArgs = mockCreate.mock.calls[0][0];
      const userMessage = callArgs.messages[1].content;
      // The snapshot portion should not exceed MAX_SNAPSHOT_CHARS plus the truncation suffix
      expect(userMessage.length).toBeLessThan(longSnapshot.length);
    });

    it('returns null when AI call fails (network error)', async () => {
      const page = createMockPage({
        ariaSnapshot: '- button "OK"',
        locatorCount: 1,
      });
      mockCreate.mockRejectedValue(new Error('Network timeout'));

      const result = await findByA11yTree(page, 'ok button');

      expect(result).toBeNull();
    });
  });

  describe('Layer 3: findByVision', () => {
    it('captures viewport screenshot as JPEG, sends to GPT-4o Vision, returns coordinates when confidence >= 0.7', async () => {
      const page = createMockPage({
        screenshotBuffer: Buffer.from('fake-jpeg-data'),
        viewportSize: { width: 1920, height: 1080 },
      });
      mockCreate.mockResolvedValue(mockVisionResponse(500, 300, 0.92, 'Login button at center-right'));

      const result = await findByVision(page, 'the login button');

      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(0.92);
      expect(result!.clickedAt).toEqual({ x: 500, y: 300 });
      expect(result!.strategy).toContain('ai-vision');
      expect(page.screenshot).toHaveBeenCalledWith({ fullPage: false, type: 'jpeg', quality: 85 });
    });

    it('returns null when confidence < 0.7', async () => {
      const page = createMockPage({
        screenshotBuffer: Buffer.from('fake-jpeg'),
        viewportSize: { width: 1280, height: 720 },
      });
      mockCreate.mockResolvedValue(mockVisionResponse(100, 200, 0.4, 'Uncertain'));

      const result = await findByVision(page, 'some element');

      expect(result).toBeNull();
    });

    it('uses viewport screenshot (fullPage: false), NOT full-page screenshot', async () => {
      const page = createMockPage({
        screenshotBuffer: Buffer.from('fake-jpeg'),
        viewportSize: { width: 800, height: 600 },
      });
      mockCreate.mockResolvedValue(mockVisionResponse(100, 200, 0.8));

      await findByVision(page, 'a button');

      expect(page.screenshot).toHaveBeenCalledWith({ fullPage: false, type: 'jpeg', quality: 85 });
    });

    it('includes viewport dimensions in the prompt to GPT-4o', async () => {
      const page = createMockPage({
        screenshotBuffer: Buffer.from('fake-jpeg'),
        viewportSize: { width: 1440, height: 900 },
      });
      mockCreate.mockResolvedValue(mockVisionResponse(720, 450, 0.88));

      await findByVision(page, 'submit button');

      const callArgs = mockCreate.mock.calls[0][0];
      // The user message should contain the viewport dimensions
      const userContent = callArgs.messages[1].content;
      const hasDimensions = JSON.stringify(userContent).includes('1440') && JSON.stringify(userContent).includes('900');
      expect(hasDimensions).toBe(true);
    });
  });
});
