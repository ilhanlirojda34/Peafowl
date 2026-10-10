import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('applies defaults when only the API key is set', () => {
    const config = loadConfig({ GOOGLE_GENERATIVE_AI_API_KEY: 'test-key' });

    assert.equal(config.googleApiKey, 'test-key');
    assert.equal(config.model, 'gemini-3.8-flash');
    assert.equal(config.llmTimeoutMs, 300_000);
    assert.equal(config.llmMaxRetries, 2);
    assert.equal(config.logLevel, 'info');
    assert.equal(config.evalConcurrency, 2);
  });

  it('coerces numeric variables from strings', () => {
    const config = loadConfig({
      GOOGLE_GENERATIVE_AI_API_KEY: 'test-key',
      LLM_TIMEOUT_MS: '5000',
      EVAL_CONCURRENCY: '4',
    });

    assert.equal(config.llmTimeoutMs, 5000);
    assert.equal(config.evalConcurrency, 4);
  });

  it('rejects a missing API key and names the variable', () => {
    assert.throws(
      () => loadConfig({}),
      (error: unknown) =>
        error instanceof ConfigError && error.message.includes('GOOGLE_GENERATIVE_AI_API_KEY'),
    );
  });

  it('does not echo invalid values in the error message', () => {
    const secretLookingValue = 'not-a-number-secret';

    assert.throws(
      () =>
        loadConfig({
          GOOGLE_GENERATIVE_AI_API_KEY: 'test-key',
          LLM_TIMEOUT_MS: secretLookingValue,
        }),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.message.includes('LLM_TIMEOUT_MS') &&
        !error.message.includes(secretLookingValue),
    );
  });
});
