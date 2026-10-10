import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import pino from 'pino';
import { SiteGenerationError } from './errors.ts';
import { createSiteRenderer, renderInputFor } from './render.ts';
import type { SiteSpec } from './spec.ts';

type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer P>
    ? P
    : never;

const SPEC: SiteSpec = {
  schemaVersion: 1,
  kind: 'business',
  language: 'tr',
  subject: {
    name: 'Moda Kahve',
    category: 'kahve dükkanı',
    location: null,
    summary: null,
    schedule: 'Her gün 08.00–20.00',
  },
  items: [{ name: 'Filtre kahve', description: null, price: '90 TL' }],
  contact: { phone: '0216 555 12 34', email: null, address: null, url: null },
  primaryAction: 'call',
  tone: 'friendly',
};

const DOCUMENT = '<!doctype html><html lang="tr"><body><h1>Kahve</h1></body></html>';

const FINISH: StreamPart = {
  type: 'finish',
  finishReason: { unified: 'stop', raw: 'STOP' },
  usage: {
    inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 40, text: 30, reasoning: 10 },
  },
};

function textParts(...deltas: string[]): StreamPart[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    ...deltas.map((delta): StreamPart => ({ type: 'text-delta', id: 't', delta })),
    { type: 'text-end', id: 't' },
  ];
}

function generatorFor(chunks: StreamPart[], options: { initialDelayInMs?: number } = {}) {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks,
        initialDelayInMs: options.initialDelayInMs ?? 0,
        chunkDelayInMs: 0,
      }),
    }),
  });
  return createSiteRenderer({
    model,
    config: { model: 'mock', llmTimeoutMs: 5_000, llmIdleTimeoutMs: 100, llmMaxRetries: 0 },
    logger: pino({ level: 'silent' }),
    prompt: { text: 'system', version: 'test' },
  });
}

async function assertGenerationFails(
  promise: Promise<unknown>,
  kind: SiteGenerationError['kind'],
): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof SiteGenerationError && error.kind === kind,
  );
}

describe('createSiteRenderer', () => {
  it('assembles streamed text into a clean document with token usage', async () => {
    const generate = generatorFor([
      ...textParts('```html\n', DOCUMENT.slice(0, 30), DOCUMENT.slice(30), '\n```'),
      FINISH,
    ]);

    const site = await generate(SPEC);

    assert.equal(site.html, DOCUMENT);
    assert.equal(site.inputTokens, 120);
    assert.equal(site.outputTokens, 40);
  });

  it('reports a provider error from the stream as request-failed', async () => {
    const generate = generatorFor([
      { type: 'stream-start', warnings: [] },
      {
        type: 'error',
        error: new APICallError({
          message: 'Unauthorized',
          url: 'https://example.test',
          requestBodyValues: {},
          statusCode: 401,
          isRetryable: false,
        }),
      },
    ]);

    await assertGenerationFails(generate(SPEC), 'request-failed');
  });

  it('fails with request-failed when the model stays silent past the idle timeout', async () => {
    const generate = generatorFor([...textParts(DOCUMENT), FINISH], { initialDelayInMs: 1_000 });

    await assertGenerationFails(generate(SPEC), 'request-failed');
  });

  it('reports a cut-off document as invalid-output', async () => {
    const generate = generatorFor([...textParts('<!doctype html><html><body>'), FINISH]);

    await assertGenerationFails(generate(SPEC), 'invalid-output');
  });
});

describe('renderInputFor', () => {
  it('sends only known facts plus the sections and button link decided by code', () => {
    const input = JSON.parse(renderInputFor(SPEC));

    assert.deepEqual(input.subject, {
      name: 'Moda Kahve',
      category: 'kahve dükkanı',
      schedule: 'Her gün 08.00–20.00',
    });
    assert.deepEqual(input.items, [{ name: 'Filtre kahve', price: '90 TL' }]);
    assert.deepEqual(input.contact, { phone: '0216 555 12 34' });
    assert.deepEqual(input.sections, ['hero', 'items', 'contact']);
    assert.deepEqual(input.primaryAction, { type: 'call', href: 'tel:02165551234' });
  });
});
