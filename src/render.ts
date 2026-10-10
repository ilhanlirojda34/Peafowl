import { streamText, type FinishReason, type LanguageModel, type LanguageModelUsage } from 'ai';
import type { Config } from './config.ts';
import { describeProviderError, requestFailed, SiteGenerationError } from './errors.ts';
import type { Logger } from './logger.ts';
import type { SystemPrompt } from './prompt.ts';
import { extractHtmlDocument, InvalidHtmlError } from './sanitize.ts';
import { primaryActionHref, sectionsFor, type SiteSpec } from './spec.ts';
import { elapsedSince } from './timing.ts';

export interface RenderedSite {
  readonly html: string;
  readonly durationMs: number;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
}

export type RenderSite = (spec: SiteSpec, abortSignal?: AbortSignal) => Promise<RenderedSite>;

type RendererConfig = Pick<Config, 'model' | 'llmTimeoutMs' | 'llmIdleTimeoutMs' | 'llmMaxRetries'>;

interface SiteRendererDependencies {
  readonly model: LanguageModel;
  readonly config: RendererConfig;
  readonly logger: Logger;
  readonly prompt: SystemPrompt;
}

/**
 * What the model receives: only the facts that exist (null fields are left out, so there is
 * nothing to fill in), plus decisions code has already made — the sections and the button link.
 */
export function renderInputFor(spec: SiteSpec): string {
  const known = <T extends object>(record: T) =>
    Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null));

  return JSON.stringify(
    {
      language: spec.language,
      kind: spec.kind,
      tone: spec.tone,
      subject: known(spec.subject),
      items: spec.items.map(known),
      contact: known(spec.contact),
      sections: sectionsFor(spec),
      primaryAction: { type: spec.primaryAction, href: primaryActionHref(spec) },
    },
    null,
    2,
  );
}

/**
 * Step 3 of the pipeline: turns a complete SiteSpec into an HTML document. The response is
 * streamed so a stalled model is cut off by the idle timeout while a slow but progressing one
 * can finish. Failures become SiteGenerationError and are logged once; spec content is not logged.
 */
export function createSiteRenderer({
  model,
  config,
  logger,
  prompt,
}: SiteRendererDependencies): RenderSite {
  const log = logger.child({ step: 'render', model: config.model, promptVersion: prompt.version });

  return async (spec, abortSignal) => {
    const startedAt = performance.now();

    const result = streamText({
      model,
      system: prompt.text,
      prompt: renderInputFor(spec),
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
      log.error({ ...describeProviderError(outcome.error), ...progress }, 'Render request failed');
      throw requestFailed(outcome.error);
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
      'Site rendered',
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
