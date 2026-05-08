import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { createThumbnail, screenshotPage } from '../src/utils/thumbnails.js';

describe('createThumbnail', () => {
  it('returns a base64 string of a resized PNG image', async () => {
    // Create a small test image (1x1 red pixel PNG)
    const inputBuffer = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    }).png().toBuffer();

    const result = await createThumbnail(inputBuffer);

    expect(typeof result).toBe('string');

    // Decode base64 and verify dimensions
    const outputBuffer = Buffer.from(result, 'base64');
    const metadata = await sharp(outputBuffer).metadata();
    expect(metadata.width).toBe(400);
  });

  it('uses custom width when provided', async () => {
    const inputBuffer = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 },
      },
    }).png().toBuffer();

    const result = await createThumbnail(inputBuffer, 200);

    const outputBuffer = Buffer.from(result, 'base64');
    const metadata = await sharp(outputBuffer).metadata();
    expect(metadata.width).toBe(200);
  });
});

describe('screenshotPage', () => {
  it('returns a base64 thumbnail from a Playwright Page screenshot', async () => {
    const mockScreenshotBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 128, g: 128, b: 128, alpha: 1 },
      },
    }).png().toBuffer();

    const mockPage = {
      screenshot: vi.fn().mockResolvedValue(mockScreenshotBuffer),
    };

    const result = await screenshotPage(mockPage as any);

    expect(typeof result).toBe('string');

    // Verify it was resized
    const outputBuffer = Buffer.from(result, 'base64');
    const metadata = await sharp(outputBuffer).metadata();
    expect(metadata.width).toBe(400);
    expect(mockPage.screenshot).toHaveBeenCalledWith({ type: 'png', timeout: 5000 });
  });

  it('returns a fallback base64 image when screenshot capture fails', async () => {
    const mockPage = {
      screenshot: vi.fn().mockRejectedValue(new Error('screenshot timeout')),
    };

    const result = await screenshotPage(mockPage as any);
    const outputBuffer = Buffer.from(result, 'base64');
    const metadata = await sharp(outputBuffer).metadata();

    expect(metadata.width).toBe(1);
    expect(metadata.height).toBe(1);
  });
});
