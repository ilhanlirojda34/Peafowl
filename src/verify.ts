import { primaryActionHref, type SiteSpec } from './spec.ts';

export type FactKind = 'phone' | 'email' | 'link' | 'price';

export interface UnsupportedFact {
  readonly kind: FactKind;
  readonly value: string;
}

/**
 * Step 4 of the pipeline: lists the checkable facts on the page that the spec does not contain.
 * A non-empty result means the model invented something, and the generation must not be shown.
 *
 * This is a deliberate heuristic over the HTML text, not a full parser: it covers the facts that
 * hurt most when invented (contact details, links, prices) and errs towards flagging.
 */
export function findUnsupportedFacts(html: string, spec: SiteSpec): UnsupportedFact[] {
  const page = readPage(html);
  const specText = flattenStrings(spec).join('\n');

  const knownPhones = new Set(findPhones(specText).map(phoneKey));
  const knownEmails = new Set(findEmails(specText).map((email) => email.toLowerCase()));
  // Any number in the spec backs a page amount, so "aylık 300" in the spec covers "300 TL".
  const knownAmounts = new Set(findNumbers(specText).map(amountKey));

  const pagePhones = [
    ...findPhones(page.text),
    ...page.hrefs.filter((href) => /^tel:/i.test(href)).map((href) => href.slice(4)),
  ];
  const pageEmails = [
    ...findEmails(page.text),
    ...page.hrefs
      .filter((href) => /^mailto:/i.test(href))
      .map((href) => href.slice(7).split('?')[0] ?? ''),
  ];

  const facts: UnsupportedFact[] = [
    ...pagePhones
      .filter((phone) => !knownPhones.has(phoneKey(phone)))
      .map((value) => ({ kind: 'phone' as const, value })),
    ...pageEmails
      .filter((email) => !knownEmails.has(email.toLowerCase()))
      .map((value) => ({ kind: 'email' as const, value })),
    ...page.hrefs
      .filter((href) => /^https?:/i.test(href) && !isAllowedLink(href, spec))
      .map((value) => ({ kind: 'link' as const, value })),
    ...findAmounts(page.text)
      .filter((amount) => !knownAmounts.has(amountKey(amount)))
      .map((value) => ({ kind: 'price' as const, value })),
  ];

  return dedupe(facts);
}

// ---------------------------------------------------------------------------------------------

interface PageContent {
  /** Visible text: scripts, styles, inline SVG and markup removed, entities decoded. */
  readonly text: string;
  /** href values of anchors, entities decoded. */
  readonly hrefs: readonly string[];
}

const HIDDEN_BLOCKS = /<(script|style|svg)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi;
// Tags become line breaks and phone candidates never span one, so numbers in neighbouring
// elements are not joined into a fake phone number.
const ANCHOR_HREF = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1/gi;

function readPage(html: string): PageContent {
  const hrefs = [...html.matchAll(ANCHOR_HREF)].map((match) =>
    decodeEntities(match[2] ?? '').trim(),
  );
  const text = decodeEntities(html.replace(HIDDEN_BLOCKS, ' ').replace(/<[^>]+>/g, '\n'));
  return { text, hrefs };
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
}

const PHONE_CANDIDATE = /\+?\d[\d \t\u00a0().-]{6,}\d/g;
const MIN_PHONE_DIGITS = 10;
const MAX_PHONE_DIGITS = 15;
/** Numbers are compared on their national part, so "+90 216 …" and "0216 …" match. */
const NATIONAL_DIGITS = 10;

function findPhones(text: string): string[] {
  return [...text.matchAll(PHONE_CANDIDATE)]
    .map((match) => match[0].trim())
    .filter((candidate) => {
      const digits = candidate.replace(/\D/g, '').length;
      return digits >= MIN_PHONE_DIGITS && digits <= MAX_PHONE_DIGITS;
    });
}

function phoneKey(phone: string): string {
  return phone.replace(/\D/g, '').slice(-NATIONAL_DIGITS);
}

const EMAIL = /[a-z\d._%+-]+@[a-z\d.-]+\.[a-z]{2,}/gi;

function findEmails(text: string): string[] {
  return [...text.matchAll(EMAIL)].map((match) => match[0]);
}

const AMOUNT =
  /(?:[₺$€£]\s?\d[\d.,]*\d|[₺$€£]\s?\d)|(?:\d[\d.,]*\d|\d)\s?(?:[₺$€£]|(?:TL|TRY|USD|EUR|GBP)\b)/gi;

function findAmounts(text: string): string[] {
  return [...text.matchAll(AMOUNT)].map((match) => match[0]);
}

function findNumbers(text: string): string[] {
  return [...text.matchAll(/\d[\d.,]*\d|\d/g)].map((match) => match[0]);
}

/** "₺1.250,00", "1250 TL" and "1.250 ₺" all become "1250". */
function amountKey(amount: string): string {
  const number = amount.replace(/[^\d.,]/g, '').replace(/[.,]\d{1,2}$/, '');
  return number.replace(/\D/g, '');
}

function isAllowedLink(href: string, spec: SiteSpec): boolean {
  if (href === primaryActionHref(spec)) return true;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^www\./, '');

  if (
    spec.contact.url !== null &&
    host === new URL(spec.contact.url).hostname.replace(/^www\./, '')
  ) {
    return true;
  }
  const isMapsLink =
    host === 'maps.google.com' || (host === 'google.com' && url.pathname.startsWith('/maps'));
  if (isMapsLink) return spec.contact.address !== null;
  if (host === 'wa.me') {
    return spec.contact.phone !== null && phoneKey(url.pathname) === phoneKey(spec.contact.phone);
  }
  return false;
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  if (value !== null && typeof value === 'object')
    return Object.values(value).flatMap(flattenStrings);
  return [];
}

function dedupe(facts: UnsupportedFact[]): UnsupportedFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.kind}:${fact.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
