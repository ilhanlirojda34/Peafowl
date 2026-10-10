import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import pino from 'pino';
import { createSiteGenerator, describeProviderError, SiteGenerationError } from './generate.ts';

type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer P>
    ? P
    : never;

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
  return createSiteGenerator({
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

describe('createSiteGenerator', () => {
  it('assembles streamed text into a clean document with token usage', async () => {
    const generate = generatorFor([
      ...textParts('```html\n', DOCUMENT.slice(0, 30), DOCUMENT.slice(30), '\n```'),
      FINISH,
    ]);

    const site = await generate('kahve dükkanı');

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

    await assertGenerationFails(generate('brief'), 'request-failed');
  });

  it('fails with request-failed when the model stays silent past the idle timeout', async () => {
    const generate = generatorFor([...textParts(DOCUMENT), FINISH], { initialDelayInMs: 1_000 });

    await assertGenerationFails(generate('brief'), 'request-failed');
  });

  it('reports a cut-off document as invalid-output', async () => {
    const generate = generatorFor([...textParts('<!doctype html><html><body>'), FINISH]);

    await assertGenerationFails(generate('brief'), 'invalid-output');
  });
});

describe('describeProviderError', () => {
  it('keeps status and message but drops the request body', () => {
    const error = new APICallError({
      message: 'Request had invalid authentication credentials.',
      url: 'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent',
      requestBodyValues: { contents: 'private user brief' },
      statusCode: 401,
      responseBody: '{"error":{}}',
      isRetryable: false,
    });

    const described = describeProviderError(error);

    assert.deepEqual(described, {
      errorMessage: 'Request had invalid authentication credentials.',
      statusCode: 401,
      retryable: false,
    });
    assert.ok(!JSON.stringify(described).includes('private user brief'));
  });

  it('handles non-provider errors', () => {
    assert.deepEqual(describeProviderError(new Error('timeout')), {
      errorMessage: 'timeout',
      statusCode: undefined,
      retryable: undefined,
    });
  });
});
