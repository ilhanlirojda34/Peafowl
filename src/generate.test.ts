import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APICallError } from 'ai';
import { describeProviderError } from './generate.ts';

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
