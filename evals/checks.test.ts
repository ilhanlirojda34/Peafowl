import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runHtmlChecks } from './checks.ts';

const FILLER = '<p>Freshly roasted beans, delivered every week.</p>'.repeat(80);

const GOOD_DOCUMENT = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kuru Coffee Roasters</title>
</head>
<body>
  <header><nav>Menu</nav></header>
  <main>
    <h1>Kuru Coffee Roasters</h1>
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Roasting drum">
    ${FILLER}
  </main>
  <footer>Contact</footer>
</body>
</html>`;

function failedChecks(html: string): string[] {
  return runHtmlChecks(html)
    .filter((result) => !result.passed)
    .map((result) => result.name);
}

describe('runHtmlChecks', () => {
  it('passes a well-formed document', () => {
    assert.deepEqual(failedChecks(GOOD_DOCUMENT), []);
  });

  it('flags a missing viewport meta tag', () => {
    const html = GOOD_DOCUMENT.replace(/<meta name="viewport"[^>]*>/, '');
    assert.deepEqual(failedChecks(html), ['has-viewport-meta']);
  });

  it('flags placeholder copy', () => {
    const html = GOOD_DOCUMENT.replace('Roasting drum', 'Lorem ipsum');
    assert.deepEqual(failedChecks(html), ['no-placeholder-copy']);
  });

  it('flags external image URLs', () => {
    const html = GOOD_DOCUMENT.replace(
      'src="data:image/gif;base64,R0lGODlhAQABAAAAACw="',
      'src="https://images.example.com/drum.jpg"',
    );
    assert.deepEqual(failedChecks(html), ['no-external-images']);
  });

  it('flags images without alt text', () => {
    const html = GOOD_DOCUMENT.replace(' alt="Roasting drum"', '');
    assert.deepEqual(failedChecks(html), ['images-have-alt']);
  });

  it('flags multiple h1 elements', () => {
    const html = GOOD_DOCUMENT.replace('</main>', '<h1>Second</h1></main>');
    assert.deepEqual(failedChecks(html), ['single-h1']);
  });

  it('flags trivially short output', () => {
    assert.ok(
      failedChecks('<!doctype html><html lang="en"></html>').includes('substantial-content'),
    );
  });
});
