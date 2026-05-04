import type { Page, Locator } from 'playwright-core';
import { findElement } from './elementFinder.js';
import type { FindResult } from './elementFinder.js';
import { findByA11yTree, findByVision } from './aiElementFinder.js';
import { screenshotPage } from '../utils/thumbnails.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Diagnostic info for a single layer that failed during cascade. */
export interface LayerDiagnostic {
  layer: number;
  name: string;
  error?: string;
  reason?: string;
}

/** Extended FindResult carrying optional AI metadata from Layers 2/3. */
export interface CascadeResult extends FindResult {
  confidence?: number;
  clickedAt?: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// ElementNotFoundError
// ---------------------------------------------------------------------------

/**
 * Thrown when all three cascade layers fail to find the element.
 * Carries a screenshot and per-layer diagnostics for debugging.
 */
export class ElementNotFoundError extends Error {
  readonly description: string;
  readonly diagnostics: LayerDiagnostic[];
  readonly screenshot: string;

  constructor(description: string, diagnostics: LayerDiagnostic[], screenshot: string) {
    const details = diagnostics
      .map((d) => {
        const reason = d.error ?? d.reason ?? 'unknown';
        return `Layer ${d.layer} (${d.name}) - ${reason}`;
      })
      .join(', ');

    super(`Element not found: "${description}". Tried: ${details}`);
    this.name = 'ElementNotFoundError';
    this.description = description;
    this.diagnostics = diagnostics;
    this.screenshot = screenshot;
  }
}

// ---------------------------------------------------------------------------
// 3-Layer Cascade Controller
// ---------------------------------------------------------------------------

/**
 * Find an element using a 3-layer cascade:
 *   Layer 1: Heuristic (fast, no AI tokens)
 *   Layer 2: a11y tree + GPT-4o (structured text analysis)
 *   Layer 3: Screenshot + GPT-4o Vision (coordinate-based fallback)
 *
 * Returns as soon as a layer succeeds. If all layers fail, throws
 * ElementNotFoundError with a page screenshot and per-layer diagnostics.
 */
export async function findElementWithAI(
  page: Page,
  description: string,
): Promise<CascadeResult> {
  const diagnostics: LayerDiagnostic[] = [];

  // --- Layer 1: Heuristic (no AI tokens) ---
  try {
    return await findElement(page, description);
  } catch (err) {
    diagnostics.push({
      layer: 1,
      name: 'heuristic',
      error: (err as Error).message,
    });
  }

  // --- Layer 2: a11y tree + GPT-4o ---
  try {
    const result = await findByA11yTree(page, description);
    if (result) {
      return {
        locator: result.locator,
        strategy: result.strategy,
        confidence: result.confidence,
      };
    }
    diagnostics.push({ layer: 2, name: 'a11y-tree', reason: 'no result' });
  } catch (err) {
    diagnostics.push({
      layer: 2,
      name: 'a11y-tree',
      error: (err as Error).message,
    });
  }

  // --- Layer 3: Vision + GPT-4o Vision ---
  try {
    const result = await findByVision(page, description);
    if (result) {
      return {
        locator: result.locator,
        strategy: result.strategy,
        confidence: result.confidence,
        clickedAt: result.clickedAt,
      };
    }
    diagnostics.push({ layer: 3, name: 'vision', reason: 'no result' });
  } catch (err) {
    diagnostics.push({
      layer: 3,
      name: 'vision',
      error: (err as Error).message,
    });
  }

  // --- All layers failed: capture screenshot and throw ---
  const screenshot = await screenshotPage(page);
  throw new ElementNotFoundError(description, diagnostics, screenshot);
}
