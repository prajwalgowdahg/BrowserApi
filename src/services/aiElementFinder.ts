import type { Page, Locator } from 'playwright-core';
import { getAIClient, getDeploymentName } from './aiClient.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum confidence score to accept an AI result. */
export const CONFIDENCE_THRESHOLD = 0.7;

/** Maximum characters for an accessibility tree snapshot before truncation. */
export const MAX_SNAPSHOT_CHARS = 15000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result from an AI-powered element finding layer. */
export interface AIResult {
  locator: Locator;
  strategy: string;
  confidence: number;
  clickedAt?: { x: number; y: number };
}

/** Expected response shape from GPT-4o for a11y tree analysis. */
interface A11yResponse {
  selector: string;
  strategy: 'css' | 'role' | 'text' | 'label' | 'testId';
  confidence: number;
  reasoning: string;
}

/** Expected response shape from GPT-4o Vision for coordinate finding. */
interface VisionResponse {
  x: number;
  y: number;
  confidence: number;
  description: string;
}

// ---------------------------------------------------------------------------
// Prompt Templates
// ---------------------------------------------------------------------------

const A11Y_TREE_SYSTEM_PROMPT = `You are an expert at analyzing web page accessibility trees to locate UI elements.

Given an accessibility tree in YAML format and a natural-language description of an element, identify the best matching element and return a Playwright-compatible selector.

Your response MUST be a JSON object with these fields:
- "selector": A string used with the Playwright locator method indicated by "strategy"
- "strategy": One of "css", "role", "text", "label", "testId"
  - "css": Use page.locator(selector) -- selector is a CSS selector
  - "role": Use page.getByRole(selector) -- selector is the ARIA role name (e.g. "button", "link")
  - "text": Use page.getByText(selector) -- selector is the visible text
  - "label": Use page.getByLabel(selector) -- selector is the label text
  - "testId": Use page.getByTestId(selector) -- selector is the test ID value
- "confidence": A number from 0.0 to 1.0 indicating how certain you are
- "reasoning": Brief explanation of why this element matches

Rules:
- Prefer the most specific strategy (role > label > text > css)
- If no element clearly matches the description, set confidence below 0.5
- For role strategy, the selector should be just the role name (e.g. "button"), not a full selector
- Be precise -- wrong selectors will cause failures`;

const VISION_SYSTEM_PROMPT = `You are an expert at identifying UI elements in web page screenshots.

Given a screenshot of a web page viewport and a natural-language description of an element, identify the element and return the x,y coordinates where a user would click it.

Your response MUST be a JSON object with these fields:
- "x": Horizontal pixel coordinate (relative to viewport left edge)
- "y": Vertical pixel coordinate (relative to viewport top edge)
- "confidence": A number from 0.0 to 1.0 indicating how certain you are
- "description": Brief description of what you found at those coordinates

Rules:
- Coordinates are relative to the viewport, not the full page
- The coordinates should point to the CENTER of the target element
- If the element is not visible in the screenshot, set confidence below 0.5
- Consider the viewport dimensions provided when estimating coordinates`;

// ---------------------------------------------------------------------------
// Layer 2: Accessibility Tree + GPT-4o
// ---------------------------------------------------------------------------

/**
 * Find an element by sending the page's accessibility tree to GPT-4o.
 * Returns null if confidence is below threshold or selector matches nothing.
 */
export async function findByA11yTree(
  page: Page,
  description: string,
): Promise<AIResult | null> {
  try {
    // Capture accessibility tree
    let snapshot = await (page as any).ariaSnapshot();

    // Truncate if too large
    if (snapshot.length > MAX_SNAPSHOT_CHARS) {
      snapshot = snapshot.slice(0, MAX_SNAPSHOT_CHARS) + '\n... [truncated]';
    }

    const client = getAIClient();

    const response = await client.chat.completions.create({
      model: getDeploymentName(),
      messages: [
        { role: 'system', content: A11Y_TREE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Find the element described as: "${description}"\n\nAccessibility tree:\n${snapshot}`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
    });

    const content = response.choices[0].message.content;
    if (!content) return null;

    const parsed: A11yResponse = JSON.parse(content);

    if (parsed.confidence < CONFIDENCE_THRESHOLD) {
      return null;
    }

    // Build the Playwright Locator based on strategy
    let locator: Locator;
    switch (parsed.strategy) {
      case 'css':
        locator = page.locator(parsed.selector).first();
        break;
      case 'role':
        locator = page.getByRole(parsed.selector as any).first();
        break;
      case 'text':
        locator = page.getByText(parsed.selector).first();
        break;
      case 'label':
        locator = page.getByLabel(parsed.selector).first();
        break;
      case 'testId':
        locator = page.getByTestId(parsed.selector).first();
        break;
      default:
        locator = page.locator(parsed.selector).first();
    }

    // Validate the locator actually matches something
    const count = await locator.count();
    if (count === 0) {
      return null;
    }

    return {
      locator,
      strategy: `ai-a11y:${parsed.strategy}`,
      confidence: parsed.confidence,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Layer 3: Screenshot + GPT-4o Vision
// ---------------------------------------------------------------------------

/**
 * Find an element by sending a viewport screenshot to GPT-4o Vision.
 * Returns coordinates and a body locator. Does NOT click.
 * Returns null if confidence is below threshold.
 */
export async function findByVision(
  page: Page,
  description: string,
): Promise<AIResult | null> {
  try {
    // Capture viewport-only screenshot as JPEG
    const screenshotBuffer = await page.screenshot({
      fullPage: false,
      type: 'jpeg',
      quality: 85,
    });

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    const base64Image = screenshotBuffer.toString('base64');

    const client = getAIClient();

    const response = await client.chat.completions.create({
      model: getDeploymentName(),
      messages: [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Find the element described as: "${description}"\nViewport dimensions: ${viewport.width}x${viewport.height} pixels`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300,
    });

    const content = response.choices[0].message.content;
    if (!content) return null;

    const parsed: VisionResponse = JSON.parse(content);

    if (parsed.confidence < CONFIDENCE_THRESHOLD) {
      return null;
    }

    return {
      locator: page.locator('body'),
      strategy: `ai-vision:(${parsed.x},${parsed.y})`,
      confidence: parsed.confidence,
      clickedAt: { x: parsed.x, y: parsed.y },
    };
  } catch {
    return null;
  }
}
