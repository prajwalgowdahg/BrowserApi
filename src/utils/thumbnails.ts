import sharp from 'sharp';
import type { Page } from 'playwright-core';

const FALLBACK_SCREENSHOT =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

export async function createThumbnail(
  screenshotBuffer: Buffer,
  width = 400,
): Promise<string> {
  const resized = await sharp(screenshotBuffer)
    .resize(width)
    .png()
    .toBuffer();

  return resized.toString('base64');
}

export async function screenshotPage(page: Page): Promise<string> {
  try {
    const screenshotBuffer = await page.screenshot({ type: 'png', timeout: 5000 });
    return createThumbnail(screenshotBuffer);
  } catch {
    return FALLBACK_SCREENSHOT;
  }
}
