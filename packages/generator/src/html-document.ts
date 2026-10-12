export type HtmlRejectionReason = 'empty' | 'missing-doctype' | 'truncated';

export class InvalidHtmlError extends Error {
  readonly reason: HtmlRejectionReason;

  constructor(reason: HtmlRejectionReason) {
    super(`Model output is not a complete HTML document (${reason})`);
    this.reason = reason;
  }
}

const DOCTYPE = /<!doctype\s+html/i;
const CLOSING_HTML_TAG = /<\/html\s*>/gi;

/**
 * Returns the HTML document embedded in raw model output.
 * Anything outside `<!doctype html>` ... `</html>` (markdown fences, commentary) is dropped.
 */
export function extractHtmlDocument(raw: string): string {
  if (raw.trim() === '') throw new InvalidHtmlError('empty');

  const start = raw.search(DOCTYPE);
  if (start === -1) throw new InvalidHtmlError('missing-doctype');

  const lastClosingTag = [...raw.matchAll(CLOSING_HTML_TAG)].at(-1);
  if (lastClosingTag === undefined || lastClosingTag.index < start) {
    throw new InvalidHtmlError('truncated');
  }

  return raw.slice(start, lastClosingTag.index + lastClosingTag[0].length);
}
