import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
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

interface SiteGeneratorDependencies {
  readonly config: Config;
  readonly logger: Logger;
  readonly prompt: SystemPrompt;
}

/**
 * The only place that talks to the LLM. Translates provider errors and unusable output into
 * SiteGenerationError and logs each failure once. The brief itself is never logged.
 */
export function createSiteGenerator({
  config,
  logger,
  prompt,
}: SiteGeneratorDependencies): GenerateSite {
  const model = createGoogleGenerativeAI({ apiKey: config.googleApiKey })(config.model);
  const log = logger.child({ model: config.model, promptVersion: prompt.version });

  return async (brief, abortSignal) => {
    const startedAt = performance.now();

    let result;
    try {
      result = await generateText({
        model,
        system: prompt.text,
        prompt: brief,
        timeout: config.llmTimeoutMs,
        maxRetries: config.llmMaxRetries,
        abortSignal,
      });
    } catch (error) {
      log.error(
        { err: error, briefLength: brief.length, durationMs: elapsedSince(startedAt) },
        'Model request failed',
      );
      throw new SiteGenerationError('request-failed', 'The model request failed', {
        cause: error,
      });
    }

    const durationMs = elapsedSince(startedAt);
    const { inputTokens, outputTokens } = result.usage;

    let html: string;
    try {
      html = extractHtmlDocument(result.text);
    } catch (error) {
      if (!(error instanceof InvalidHtmlError)) throw error;
      log.warn(
        { reason: error.reason, finishReason: result.finishReason, outputTokens, durationMs },
        'Model returned an unusable document',
      );
      throw new SiteGenerationError('invalid-output', error.message, { cause: error });
    }

    log.info(
      { durationMs, inputTokens, outputTokens, finishReason: result.finishReason },
      'Site generated',
    );
    return { html, durationMs, inputTokens, outputTokens };
  };
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
