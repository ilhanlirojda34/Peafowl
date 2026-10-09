import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractHtmlDocument, InvalidHtmlError } from './sanitize.ts';

const DOCUMENT = '<!doctype html><html lang="en"><body><h1>Hi</h1></body></html>';

function assertRejected(raw: string, reason: InvalidHtmlError['reason']): void {
  assert.throws(
    () => extractHtmlDocument(raw),
    (error: unknown) => error instanceof InvalidHtmlError && error.reason === reason,
  );
}

describe('extractHtmlDocument', () => {
  it('returns a clean document unchanged', () => {
    assert.equal(extractHtmlDocument(DOCUMENT), DOCUMENT);
  });

  it('strips markdown fences', () => {
    assert.equal(extractHtmlDocument(`\`\`\`html\n${DOCUMENT}\n\`\`\``), DOCUMENT);
  });

  it('strips commentary before and after the document', () => {
    assert.equal(extractHtmlDocument(`Here is your site:\n${DOCUMENT}\nEnjoy!`), DOCUMENT);
  });

  it('matches the doctype and closing tag case-insensitively', () => {
    const upper = '<!DOCTYPE HTML><HTML><BODY></BODY></HTML>';
    assert.equal(extractHtmlDocument(upper), upper);
  });

  it('rejects empty output', () => {
    assertRejected('  \n ', 'empty');
  });

  it('rejects output without a doctype', () => {
    assertRejected('<div>fragment</div>', 'missing-doctype');
  });

  it('rejects a document cut off before the closing tag', () => {
    assertRejected('<!doctype html><html><body><h1>Hi', 'truncated');
  });
});
