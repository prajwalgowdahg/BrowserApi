import type { Page } from 'playwright-core';

export interface HumanCheckResult {
  required: boolean;
  reason?: string;
  evidence: string[];
  url: string;
  title: string;
}

const HUMAN_CHECK_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: 'captcha_detected', pattern: /\b(captcha|recaptcha|hcaptcha)\b/i },
  { reason: 'human_verification', pattern: /verify (that )?you are human|are you (a )?robot|prove you are human/i },
  { reason: 'unusual_traffic', pattern: /unusual traffic|automated queries|suspicious activity/i },
  { reason: 'security_check', pattern: /security check|checking your browser|just a moment|please wait while we verify/i },
  { reason: 'otp_required', pattern: /\b(otp|one[- ]time password|verification code)\b/i },
];

const CHALLENGE_URL_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: 'cloudflare_challenge', pattern: /cloudflare|cdn-cgi|challenge-platform/i },
  { reason: 'datadome_challenge', pattern: /datadome/i },
  { reason: 'perimeterx_challenge', pattern: /perimeterx|px-captcha/i },
  { reason: 'akamai_challenge', pattern: /akamai|bm-verify/i },
];

export async function detectHumanCheck(page: Page): Promise<HumanCheckResult> {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const evidence: string[] = [];
  let reason: string | undefined;

  for (const candidate of CHALLENGE_URL_PATTERNS) {
    if (candidate.pattern.test(url)) {
      reason = candidate.reason;
      evidence.push(`url matched ${candidate.reason}`);
      break;
    }
  }

  const browserSignals = await page.evaluate(() => {
    const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 5000);
    const iframes = Array.from(document.querySelectorAll('iframe')).map((iframe) => ({
      src: iframe.getAttribute('src') ?? '',
      title: iframe.getAttribute('title') ?? '',
    }));
    const dataSiteKeys = Array.from(document.querySelectorAll('[data-sitekey]')).length;
    const passwordFields = Array.from(document.querySelectorAll('input')).filter((input) =>
      /otp|one.?time|verification|code/i.test(`${input.name} ${input.id} ${input.placeholder} ${input.autocomplete}`),
    ).length;
    return { text, iframes, dataSiteKeys, passwordFields };
  }).catch(() => ({ text: '', iframes: [], dataSiteKeys: 0, passwordFields: 0 }));

  for (const candidate of HUMAN_CHECK_PATTERNS) {
    if (candidate.pattern.test(browserSignals.text) || candidate.pattern.test(title)) {
      reason = reason ?? candidate.reason;
      evidence.push(`page text matched ${candidate.reason}`);
      break;
    }
  }

  const challengeFrame = browserSignals.iframes.find((iframe) =>
    /recaptcha|hcaptcha|captcha|challenge|turnstile|arkoselabs|funcaptcha/i.test(`${iframe.src} ${iframe.title}`),
  );
  if (challengeFrame) {
    reason = reason ?? 'captcha_iframe_detected';
    evidence.push(`iframe matched challenge provider: ${challengeFrame.title || challengeFrame.src.slice(0, 120)}`);
  }

  if (browserSignals.dataSiteKeys > 0) {
    reason = reason ?? 'captcha_sitekey_detected';
    evidence.push(`${browserSignals.dataSiteKeys} data-sitekey element(s) found`);
  }

  if (browserSignals.passwordFields > 0) {
    reason = reason ?? 'otp_required';
    evidence.push(`${browserSignals.passwordFields} OTP/verification input(s) found`);
  }

  return {
    required: Boolean(reason),
    reason,
    evidence,
    url,
    title,
  };
}

