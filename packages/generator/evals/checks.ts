export interface CheckResult {
  readonly name: string;
  readonly passed: boolean;
}

interface Check {
  readonly name: string;
  readonly passes: (html: string) => boolean;
}

const MIN_HTML_LENGTH = 3000;
const PLACEHOLDER_COPY = /lorem ipsum|your company|company name|feature \d\b/i;
const IMG_TAG = /<img\b[^>]*>/gi;

const CHECKS: readonly Check[] = [
  { name: 'has-viewport-meta', passes: (html) => /<meta[^>]+name=["']viewport["']/i.test(html) },
  { name: 'has-title', passes: (html) => /<title>\s*\S[^<]*<\/title>/i.test(html) },
  { name: 'has-lang', passes: (html) => /<html[^>]+\blang=["'][a-z-]+["']/i.test(html) },
  { name: 'single-h1', passes: (html) => (html.match(/<h1[\s>]/gi) ?? []).length === 1 },
  { name: 'has-main-landmark', passes: (html) => /<main[\s>]/i.test(html) },
  { name: 'no-placeholder-copy', passes: (html) => !PLACEHOLDER_COPY.test(html) },
  { name: 'no-external-images', passes: (html) => !/<img[^>]+src=["']https?:/i.test(html) },
  {
    name: 'images-have-alt',
    passes: (html) => (html.match(IMG_TAG) ?? []).every((tag) => /\balt=/i.test(tag)),
  },
  { name: 'substantial-content', passes: (html) => html.length >= MIN_HTML_LENGTH },
];

/** Cheap structural checks on a generated document. They catch obvious failures, not bad taste. */
export function runHtmlChecks(html: string): CheckResult[] {
  return CHECKS.map(({ name, passes }) => ({ name, passed: passes(html) }));
}
