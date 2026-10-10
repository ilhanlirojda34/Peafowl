import { APICallError } from 'ai';

export type SiteGenerationFailure = 'request-failed' | 'invalid-output';

/** A model call (analysis or rendering) failed in a way the caller can report to the user. */
export class SiteGenerationError extends Error {
  readonly kind: SiteGenerationFailure;

  constructor(kind: SiteGenerationFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.kind = kind;
  }
}

/**
 * Keeps only diagnostic fields. The raw provider error also carries the request body
 * (system prompt and the user's brief), which must not end up in logs.
 */
export function describeProviderError(error: unknown): {
  errorMessage: string;
  statusCode: number | undefined;
  retryable: boolean | undefined;
} {
  if (APICallError.isInstance(error)) {
    return {
      errorMessage: error.message,
      statusCode: error.statusCode,
      retryable: error.isRetryable,
    };
  }
  return {
    errorMessage: error instanceof Error ? error.message : String(error),
    statusCode: undefined,
    retryable: undefined,
  };
}

export function requestFailed(error: unknown): SiteGenerationError {
  const failure = describeProviderError(error);
  const status = failure.statusCode === undefined ? '' : ` (HTTP ${failure.statusCode})`;
  return new SiteGenerationError(
    'request-failed',
    `The model request failed${status}: ${failure.errorMessage}`,
    { cause: error },
  );
}
