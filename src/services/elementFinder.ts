import type { Page, Locator } from 'playwright-core';

/**
 * Result of a heuristic element find operation.
 * `locator` is always a `.first()` locator to avoid strict mode violations.
 * `strategy` identifies which heuristic matched, e.g. "role:login button", "label:email".
 */
export interface FindResult {
  locator: Locator;
  strategy: string;
}

/**
 * Compound role keywords mapped to getByRole configs.
 * Order matters -- most specific phrases first.
 */
const ROLE_KEYWORDS: Map<string, { role: string; namePattern: string }> = new Map([
  ['login button', { role: 'button', namePattern: 'log\\s*in' }],
  ['sign in button', { role: 'button', namePattern: 'sign\\s*in' }],
  ['submit button', { role: 'button', namePattern: 'submit' }],
  ['search button', { role: 'button', namePattern: 'search' }],
]);

/**
 * Input type keywords mapped to HTML input type values.
 * Used for the label -> placeholder -> CSS cascade strategy.
 */
const INPUT_TYPE_KEYWORDS: Map<string, string> = new Map([
  ['email', 'email'],
  ['password', 'password'],
  ['username', 'text'],
  ['search', 'search'],
  ['phone', 'tel'],
  ['url', 'url'],
]);

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Heuristic element finder that maps plain-English descriptions to Playwright Locators.
 *
 * Cascade order:
 * 1. Exact role keyword match (compound phrases like "login button")
 * 2. Input type keywords (label -> placeholder -> CSS selector cascade)
 * 3. Generic text match via getByText
 * 4. Role-based with description as name (button/link)
 *
 * Always returns locator.first() to prevent strict mode violations.
 */
export async function findElement(page: Page, description: string): Promise<FindResult> {
  const descLower = description.toLowerCase().trim();

  // --- Strategy 1: Exact role keyword match ---
  for (const [keyword, config] of ROLE_KEYWORDS) {
    if (descLower.includes(keyword)) {
      const locator = page.getByRole(config.role as any, { name: new RegExp(config.namePattern, 'i') });
      const count = await locator.count();
      if (count > 0) {
        return { locator: locator.first(), strategy: `role:${keyword}` };
      }
    }
  }

  // --- Strategy 2: Input type keywords ---
  for (const [keyword, inputType] of INPUT_TYPE_KEYWORDS) {
    if (descLower.includes(keyword)) {
      const regex = new RegExp(keyword, 'i');

      // Try getByLabel first
      const byLabel = page.getByLabel(regex);
      if ((await byLabel.count()) > 0) {
        return { locator: byLabel.first(), strategy: `label:${keyword}` };
      }

      // Try getByPlaceholder
      const byPlaceholder = page.getByPlaceholder(regex);
      if ((await byPlaceholder.count()) > 0) {
        return { locator: byPlaceholder.first(), strategy: `placeholder:${keyword}` };
      }

      // Try CSS input[type]
      const byCss = page.locator(`input[type="${inputType}"]`);
      if ((await byCss.count()) > 0) {
        return { locator: byCss.first(), strategy: `css:input[type="${inputType}"]` };
      }
    }
  }

  // --- Strategy 3: Generic text match ---
  const byText = page.getByText(description, { exact: false });
  if ((await byText.count()) > 0) {
    return { locator: byText.first(), strategy: `text:${description}` };
  }

  // --- Strategy 4: Role-based with description as name ---
  const descRegex = new RegExp(escapeRegex(description), 'i');
  const byButton = page.getByRole('button', { name: descRegex });
  if ((await byButton.count()) > 0) {
    return { locator: byButton.first(), strategy: `role:button:${description}` };
  }

  const byLink = page.getByRole('link', { name: descRegex });
  if ((await byLink.count()) > 0) {
    return { locator: byLink.first(), strategy: `role:link:${description}` };
  }

  // --- No match found ---
  throw new Error(`Element not found: "${description}"`);
}
