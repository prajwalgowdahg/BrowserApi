import type { Page } from 'playwright-core';
import { findElementWithAI } from './cascadeFinder.js';
import { observePage } from './pageObserver.js';

export interface AdapterResult {
  url: string;
  title: string;
  status: string;
  details: Record<string, unknown>;
}

export interface FlightSearchInput {
  origin: string;
  destination: string;
  departDate: string;
  tripType?: 'one-way' | 'round-trip';
  returnDate?: string;
  passengers?: number;
  cabin?: string;
  preference?: string;
}

async function settle(page: Page, timeout = 8000): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
}

async function maybeClick(page: Page, description: string): Promise<boolean> {
  try {
    const result = await findElementWithAI(page, description);
    await result.locator.scrollIntoViewIfNeeded().catch(() => {});
    if ('clickedAt' in result && result.clickedAt) {
      await page.mouse.click(result.clickedAt.x, result.clickedAt.y);
    } else {
      await result.locator.click({ timeout: 3000 });
    }
    await settle(page, 4000);
    return true;
  } catch {
    return false;
  }
}

export async function searchSite(page: Page, url: string | undefined, query: string): Promise<AdapterResult> {
  if (url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(page);
  }

  const searchSelectors = [
    'input[type="search"]',
    'input[name="q"]',
    'input[placeholder*="Search" i]',
    'textarea[name="q"]',
  ];

  for (const selector of searchSelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
      await locator.fill(query);
      await locator.press('Enter');
      await settle(page);
      return {
        url: page.url(),
        title: await page.title(),
        status: 'searched',
        details: { query, strategy: selector },
      };
    }
  }

  const searchField = await findElementWithAI(page, 'the search input field');
  await searchField.locator.fill(query);
  await searchField.locator.press('Enter');
  await settle(page);

  return {
    url: page.url(),
    title: await page.title(),
    status: 'searched',
    details: { query, strategy: searchField.strategy },
  };
}

export async function flipkartSearchProduct(
  page: Page,
  query: string,
  filters?: Record<string, unknown>,
): Promise<AdapterResult> {
  if (!page.url().includes('flipkart.com')) {
    const directUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else {
    await dismissFlipkartLogin(page);
    try {
      await searchSite(page, undefined, query);
    } catch {
      await page.goto(`https://www.flipkart.com/search?q=${encodeURIComponent(query)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    }
  }

  await settle(page);
  await dismissFlipkartLogin(page);

  const observation = await observePage(page, 100);
  const productCards = await page.locator('a[href*="/p/"], a[href*="/itm"]').evaluateAll((links) =>
    links.slice(0, 12).map((link) => ({
      text: (link.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
      href: (link as HTMLAnchorElement).href,
    })),
  ).catch(() => []);

  return {
    url: page.url(),
    title: await page.title(),
    status: productCards.length > 0 || observation.text.toLowerCase().includes(query.toLowerCase()) ? 'results_loaded' : 'blocked_or_no_results',
    details: {
      query,
      filters: filters ?? {},
      products: productCards,
      visibleText: observation.text.slice(0, 1200),
    },
  };
}

export async function flipkartSelectSize(page: Page, size: string): Promise<AdapterResult> {
  await dismissFlipkartLogin(page);
  const candidates = [
    page.getByRole('button', { name: new RegExp(`^\\s*${size}\\s*$`, 'i') }).first(),
    page.getByText(new RegExp(`^\\s*${size}\\s*$`, 'i')).first(),
    page.locator(`[id*="${size}"], [class*="${size}"]`).first(),
  ];

  let selected = false;
  let strategy = '';
  for (const locator of candidates) {
    if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.click({ timeout: 3000 }).catch(() => {});
      selected = true;
      strategy = 'direct-size-match';
      break;
    }
  }

  if (!selected) {
    selected = await maybeClick(page, `size ${size}`);
    strategy = 'ai-size-match';
  }

  const text = (await observePage(page, 80)).text.toLowerCase();
  const unavailable = /(out of stock|unavailable|sold out|currently unavailable)/i.test(text);

  return {
    url: page.url(),
    title: await page.title(),
    status: selected && !unavailable ? 'size_selected' : 'size_unavailable_or_not_found',
    details: { size, selected, unavailable, strategy },
  };
}

export async function bookingSearchHotels(
  page: Page,
  destination: string,
  dates?: { checkin?: string; checkout?: string },
  guests?: { adults?: number; children?: number },
  rooms?: number,
  budgetMax?: number,
  currency = 'INR',
): Promise<AdapterResult> {
  const directParams = new URLSearchParams({ ss: destination });
  if (dates?.checkin) directParams.set('checkin', dates.checkin);
  if (dates?.checkout) directParams.set('checkout', dates.checkout);
  if (dates?.checkin && !dates.checkout) {
    const checkout = new Date(`${dates.checkin}T00:00:00Z`);
    checkout.setUTCDate(checkout.getUTCDate() + 1);
    directParams.set('checkout', checkout.toISOString().slice(0, 10));
  }
  if (guests?.adults) directParams.set('group_adults', String(guests.adults));
  if (guests?.children) directParams.set('group_children', String(guests.children));
  if (rooms) directParams.set('no_rooms', String(rooms));
  if (budgetMax && Number.isFinite(budgetMax)) {
    directParams.set('selected_currency', currency);
    directParams.set('nflt', `price=${currency}-0-${Math.floor(budgetMax)}-1`);
  }

  await page.goto(`https://www.booking.com/searchresults.html?${directParams.toString()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await settle(page);

  const hotels = await page.locator('[data-testid="property-card"], div:has([data-testid="title"])').evaluateAll((cards) =>
    cards.slice(0, 10).map((card) => ({
      text: (card.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
    })),
  ).catch(() => []);

  const observation = await observePage(page, 100);
  return {
    url: page.url(),
    title: await page.title(),
    status: hotels.length > 0 || observation.text.toLowerCase().includes(destination.toLowerCase()) ? 'results_loaded' : 'blocked_or_no_results',
    details: {
      destination,
      dates: dates ?? {},
      guests: guests ?? {},
      rooms,
      budgetMax,
      currency,
      hotels,
      visibleText: observation.text.slice(0, 1200),
    },
  };
}

export async function googleFlightsSearch(page: Page, input: FlightSearchInput): Promise<AdapterResult> {
  const tripType = input.tripType ?? 'one-way';
  const queryParts = [
    tripType,
    'flight',
    'from',
    input.origin,
    'to',
    input.destination,
    'on',
    input.departDate,
    input.returnDate ? `return ${input.returnDate}` : '',
    input.passengers ? `${input.passengers} passenger${input.passengers === 1 ? '' : 's'}` : '',
    input.cabin ?? '',
    input.preference ?? 'cheapest good deal',
  ].filter(Boolean);
  const query = queryParts.join(' ');
  const url = `https://www.google.com/travel/flights/search?q=${encodeURIComponent(query)}`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 10000);

  const flightCards = await page.locator('[role="listitem"], [data-flt-ve], div:has-text("INR"), div:has-text("Rs")').evaluateAll((cards) =>
    cards.slice(0, 20).map((card) => ({
      text: (card.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
    })).filter((card) => /INR|Rs|flight|airline|nonstop|stop|departure|arrival|IndiGo|Air India|Vistara|Akasa/i.test(card.text)),
  ).catch(() => []);

  const observation = await observePage(page, 100).catch(async () => ({
    url: page.url(),
    title: await page.title().catch(() => ''),
    text: '',
    viewport: page.viewportSize(),
    elements: [],
    forms: [],
  }));

  return {
    url: page.url(),
    title: await page.title().catch(() => observation.title),
    status: flightCards.length > 0 || /flight|Bengaluru|Delhi|price|INR|Rs/i.test(observation.text)
      ? 'results_loaded'
      : 'blocked_or_no_results',
    details: {
      ...input,
      query,
      flights: flightCards.slice(0, 10),
      visibleText: observation.text.slice(0, 1600),
    },
  };
}

async function dismissFlipkartLogin(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {});
  const closeCandidates = [
    page.getByRole('button', { name: /close/i }).first(),
    page.getByText(/^close$/i).first(),
    page.locator('button:has-text("x")').first(),
  ];
  for (const candidate of closeCandidates) {
    if ((await candidate.count().catch(() => 0)) > 0 && (await candidate.isVisible().catch(() => false))) {
      await candidate.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}
