import type { Page, Locator } from 'playwright-core';

export interface InteractiveElement {
  id: string;
  tag: string;
  role: string | null;
  type: string | null;
  text: string;
  label: string;
  placeholder: string | null;
  href: string | null;
  visible: boolean;
  enabled: boolean;
  box: { x: number; y: number; width: number; height: number } | null;
}

export interface FormSummary {
  id: string;
  text: string;
  fields: InteractiveElement[];
  buttons: InteractiveElement[];
}

export interface PageObservation {
  url: string;
  title: string;
  text: string;
  viewport: { width: number; height: number } | null;
  elements: InteractiveElement[];
  forms: FormSummary[];
}

export interface RankedElement extends InteractiveElement {
  score: number;
  reasons: string[];
}

const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  '[role]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

const FORM_FIELD_SELECTOR = 'input, textarea, select, button, [role="button"], [contenteditable="true"]';

function normalizeSpace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function clip(value: string, max = 180): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function termsFor(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 1);
}

function scoreElement(element: InteractiveElement, query: string): RankedElement {
  const q = query.toLowerCase();
  const haystack = [
    element.text,
    element.label,
    element.placeholder,
    element.role,
    element.type,
    element.tag,
    element.href,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let score = 0;
  const reasons: string[] = [];

  if (haystack.includes(q)) {
    score += 50;
    reasons.push('exact phrase');
  }

  const terms = termsFor(query);
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 8;
      reasons.push(term);
    }
  }

  if (element.visible) score += 10;
  if (element.enabled) score += 5;
  if (element.box) score += 5;
  if (element.role === 'button' && q.includes('button')) score += 12;
  if (element.role === 'link' && (q.includes('link') || q.includes('category') || q.includes('product'))) score += 10;
  if (['input', 'textarea', 'select'].includes(element.tag) && /(input|field|search|destination|where|text)/i.test(query)) {
    score += 12;
  }

  return { ...element, score, reasons: [...new Set(reasons)] };
}

export async function observePage(page: Page, limit = 80): Promise<PageObservation> {
  const viewport = page.viewportSize();
  const raw = await page.evaluate(
    ({ interactiveSelector, formFieldSelector, maxElements }) => {
      const __name = <T>(fn: T) => fn;

      function textOf(node: Element | null): string {
        return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
      }

      function labelFor(el: Element): string {
        const aria = el.getAttribute('aria-label');
        if (aria) return aria.trim();

        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => textOf(document.getElementById(id)))
            .filter(Boolean)
            .join(' ');
          if (text) return text;
        }

        const id = el.getAttribute('id');
        if (id) {
          const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (label) return textOf(label);
        }

        const wrappingLabel = el.closest('label');
        if (wrappingLabel) return textOf(wrappingLabel);

        return '';
      }

      function isVisible(el: Element): boolean {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          Number(style.opacity || '1') > 0
        );
      }

      function isEnabled(el: Element): boolean {
        return !(el as HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement).disabled;
      }

      function summarize(el: Element, index: number) {
        const rect = el.getBoundingClientRect();
        const visible = isVisible(el);
        const text = textOf(el);
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : null);
        const htmlEl = el as HTMLElement;
        return {
          id: `e${index}`,
          tag,
          role,
          type: el.getAttribute('type'),
          text: text.slice(0, 180),
          label: labelFor(el).slice(0, 180),
          placeholder: el.getAttribute('placeholder'),
          href: el instanceof HTMLAnchorElement ? el.href : null,
          visible,
          enabled: isEnabled(el),
          box: visible
            ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              }
            : null,
          selector: htmlEl.dataset.browseapiId,
        };
      }

      const elements = Array.from(document.querySelectorAll(interactiveSelector))
        .slice(0, maxElements)
        .map((el, index) => {
          const htmlEl = el as HTMLElement;
          htmlEl.dataset.browseapiId = `e${index}`;
          return summarize(el, index);
        });

      const forms = Array.from(document.querySelectorAll('form')).slice(0, 20).map((form, formIndex) => {
        const fields = Array.from(form.querySelectorAll(formFieldSelector))
          .slice(0, 30)
          .map((field, index) => summarize(field, index));
        return {
          id: `f${formIndex}`,
          text: textOf(form).slice(0, 500),
          fields: fields.filter((field) => ['input', 'textarea', 'select'].includes(field.tag)),
          buttons: fields.filter((field) => field.tag === 'button' || field.role === 'button'),
        };
      });

      return {
        url: window.location.href,
        title: document.title,
        text: textOf(document.body).slice(0, 6000),
        elements,
        forms,
      };
    },
    { interactiveSelector: INTERACTIVE_SELECTOR, formFieldSelector: FORM_FIELD_SELECTOR, maxElements: limit },
  );

  return {
    url: raw.url,
    title: raw.title,
    text: clip(raw.text, 6000),
    viewport,
    elements: raw.elements.map((element) => ({
      id: element.id,
      tag: element.tag,
      role: element.role,
      type: element.type,
      text: normalizeSpace(element.text),
      label: normalizeSpace(element.label),
      placeholder: element.placeholder,
      href: element.href,
      visible: element.visible,
      enabled: element.enabled,
      box: element.box,
    })),
    forms: raw.forms.map((form) => ({
      id: form.id,
      text: normalizeSpace(form.text),
      fields: form.fields.map((field) => ({
        id: field.id,
        tag: field.tag,
        role: field.role,
        type: field.type,
        text: normalizeSpace(field.text),
        label: normalizeSpace(field.label),
        placeholder: field.placeholder,
        href: field.href,
        visible: field.visible,
        enabled: field.enabled,
        box: field.box,
      })),
      buttons: form.buttons.map((button) => ({
        id: button.id,
        tag: button.tag,
        role: button.role,
        type: button.type,
        text: normalizeSpace(button.text),
        label: normalizeSpace(button.label),
        placeholder: button.placeholder,
        href: button.href,
        visible: button.visible,
        enabled: button.enabled,
        box: button.box,
      })),
    })),
  };
}

export async function findRankedElements(page: Page, query: string, limit = 10): Promise<RankedElement[]> {
  const observation = await observePage(page, 120);
  return observation.elements
    .map((element) => scoreElement(element, query))
    .filter((element) => element.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function locatorForObservedId(page: Page, id: string): Promise<Locator> {
  const locator = page.locator(`[data-browseapi-id="${id}"]`).first();
  if ((await locator.count()) === 0) {
    throw new Error(`Observed element id not found: ${id}. Call observe_page or find_elements again.`);
  }
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  return locator;
}
