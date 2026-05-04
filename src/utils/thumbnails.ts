import sharp from 'sharp';
import type { Page } from 'playwright-core';

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
  const screenshotBuffer = await page.screenshot({ type: 'png' });
  return createThumbnail(screenshotBuffer);
}
