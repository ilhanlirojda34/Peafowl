import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
  APICallError,
  streamText,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
} from 'ai';
import type { Config } from './config.ts';
import type { Logger } from './logger.ts';
import type { SystemPrompt } from './prompt.ts';
import { extractHtmlDocument, InvalidHtmlError } from './sanitize.ts';

export interface GeneratedSite {
  readonly html: string;
  readonly durationMs: number;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
}

export type SiteGenerationFailure = 'request-failed' | 'invalid-output';

export class SiteGenerationError extends Error {
  readonly kind: SiteGenerationFailure;

  constructor(kind: SiteGenerationFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.kind = kind;
  }
}

export type GenerateSite = (brief: string, abortSignal?: AbortSignal) => Promise<GeneratedSite>;

type GeneratorConfig = Pick<
  Config,
  'model' | 'llmTimeoutMs' | 'llmIdleTimeoutMs' | 'llmMaxRetries'
>;

interface SiteGeneratorDependencies {
  readonly model: LanguageModel;
  readonly config: GeneratorConfig;
  readonly logger: Logger;
  readonly prompt: SystemPrompt;
}

export function createGeminiModel(config: Pick<Config, 'googleApiKey' | 'model'>): LanguageModel {
  return createGoogleGenerativeAI({ apiKey: config.googleApiKey })(config.model);
}

/**
 * The only place that talks to the LLM. The response is streamed so that a stalled model is cut
 * off by the idle timeout while a slow but progressing one is allowed to finish. Failures are
 * translated into SiteGenerationError and logged once. The brief itself is never logged.
 */
export function createSiteGenerator({
  model,
  config,
  logger,
  prompt,
}: SiteGeneratorDependencies): GenerateSite {
  const log = logger.child({ model: config.model, promptVersion: prompt.version });

  return async (brief, abortSignal) => {
    const startedAt = performance.now();

    const result = streamText({
      model,
      system: prompt.text,
      prompt: brief,
      maxRetries: config.llmMaxRetries,
      abortSignal,
      timeout: {
        totalMs: config.llmTimeoutMs,
        firstChunkMs: config.llmIdleTimeoutMs,
        chunkMs: config.llmIdleTimeoutMs,
      },
      // Thinking is streamed so the idle timeout does not fire while the model is reasoning.
      providerOptions: { google: { thinkingConfig: { includeThoughts: true } } },
      // Errors are read from the stream below; this only stops the SDK's default console output.
      onError: () => {},
    });

    const outcome = await consumeStream(result.stream, startedAt, (firstOutputMs) =>
      log.info({ firstOutputMs }, 'Model started responding'),
    );
    const progress = {
      durationMs: elapsedSince(startedAt),
      firstOutputMs: outcome.firstOutputMs,
      textChars: outcome.text.length,
      reasoningChars: outcome.reasoningChars,
    };

    if (outcome.error !== undefined) {
      const failure = describeProviderError(outcome.error);
      log.error({ ...failure, ...progress, briefLength: brief.length }, 'Model request failed');
      const status = failure.statusCode === undefined ? '' : ` (HTTP ${failure.statusCode})`;
      throw new SiteGenerationError(
        'request-failed',
        `The model request failed${status}: ${failure.errorMessage}`,
        { cause: outcome.error },
      );
    }

    const inputTokens = outcome.usage?.inputTokens;
    const outputTokens = outcome.usage?.outputTokens;

    let html: string;
    try {
      html = extractHtmlDocument(outcome.text);
    } catch (error) {
      if (!(error instanceof InvalidHtmlError)) throw error;
      log.warn(
        { reason: error.reason, finishReason: outcome.finishReason, outputTokens, ...progress },
        'Model returned an unusable document',
      );
      throw new SiteGenerationError('invalid-output', error.message, { cause: error });
    }

    log.info(
      { ...progress, inputTokens, outputTokens, finishReason: outcome.finishReason },
      'Site generated',
    );
    return { html, durationMs: progress.durationMs, inputTokens, outputTokens };
  };
}

interface StreamOutcome {
  readonly text: string;
  readonly reasoningChars: number;
  readonly firstOutputMs: number | undefined;
  readonly finishReason: FinishReason | undefined;
  readonly usage: LanguageModelUsage | undefined;
  /** Set when the stream ended in an error, abort or timeout. */
  readonly error: unknown;
}

type StreamPart =
  ReturnType<typeof streamText>['stream'] extends AsyncIterable<infer P> ? P : never;

async function consumeStream(
  stream: AsyncIterable<StreamPart>,
  startedAt: number,
  onFirstOutput: (firstOutputMs: number) => void,
): Promise<StreamOutcome> {
  let text = '';
  let reasoningChars = 0;
  let firstOutputMs: number | undefined;
  let finishReason: FinishReason | undefined;
  let usage: LanguageModelUsage | undefined;
  let error: unknown;

  const markOutput = (): void => {
    if (firstOutputMs !== undefined) return;
    firstOutputMs = elapsedSince(startedAt);
    onFirstOutput(firstOutputMs);
  };

  try {
    for await (const part of stream) {
      switch (part.type) {
        case 'text-delta':
          markOutput();
          text += part.text;
          break;
        case 'reasoning-delta':
          markOutput();
          reasoningChars += part.text.length;
          break;
        case 'finish':
          finishReason = part.finishReason;
          usage = part.totalUsage;
          break;
        case 'error':
          error = part.error;
          break;
        case 'abort':
          error = new Error(`Generation aborted${part.reason ? `: ${part.reason}` : ''}`);
          break;
      }
    }
  } catch (streamError) {
    error = streamError;
  }

  return { text, reasoningChars, firstOutputMs, finishReason, usage, error };
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

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
