import { chromium, type Browser } from 'playwright-core';
import { env } from '../config/env.js';

let browser: Browser | null = null;

export async function launchBrowser(): Promise<Browser> {
  if (browser) return browser;

  browser = await chromium.launch({
    headless: true,
    ...(env.CHROMIUM_PATH ? { executablePath: env.CHROMIUM_PATH } : {}),
  });

  return browser;
}

export function getBrowser(): Browser {
  if (!browser) {
    throw new Error('Browser not launched. Call launchBrowser() first.');
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
