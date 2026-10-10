import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';
import type { Config } from './config.ts';
import { describeProviderError, requestFailed, SiteGenerationError } from './errors.ts';
import type { Logger } from './logger.ts';
import type { SystemPrompt } from './prompt.ts';
import { siteSpecDraftSchema, type SiteSpecDraft } from './spec.ts';
import { elapsedSince } from './timing.ts';

export interface AnalysedBrief {
  readonly draft: SiteSpecDraft;
  readonly durationMs: number;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
}

export type AnalyseBrief = (brief: string, abortSignal?: AbortSignal) => Promise<AnalysedBrief>;

interface BriefAnalyzerDependencies {
  readonly model: LanguageModel;
  readonly config: Pick<Config, 'model' | 'llmTimeoutMs' | 'llmMaxRetries'>;
  readonly logger: Logger;
  readonly prompt: SystemPrompt;
}

/**
 * Step 1 of the pipeline: extracts the facts stated in a brief into a SiteSpec draft.
 * The output is schema-validated by the SDK; completing it is code's job (see completeSpec).
 * Neither the brief nor the extracted values are logged: they can contain contact details.
 */
export function createBriefAnalyzer({
  model,
  config,
  logger,
  prompt,
}: BriefAnalyzerDependencies): AnalyseBrief {
  const log = logger.child({ step: 'analyze', model: config.model, promptVersion: prompt.version });

  return async (brief, abortSignal) => {
    const startedAt = performance.now();
    try {
      const result = await generateText({
        model,
        system: prompt.text,
        // The brief is user input: it is fenced and the prompt tells the model to treat it as data.
        prompt: `<brief>\n${brief}\n</brief>`,
        output: Output.object({ schema: siteSpecDraftSchema, name: 'site_spec_draft' }),
        maxRetries: config.llmMaxRetries,
        abortSignal,
        timeout: { totalMs: config.llmTimeoutMs },
      });

      const draft = result.output;
      const analysed: AnalysedBrief = {
        draft,
        durationMs: elapsedSince(startedAt),
        inputTokens: result.totalUsage.inputTokens,
        outputTokens: result.totalUsage.outputTokens,
      };
      log.info(
        {
          durationMs: analysed.durationMs,
          inputTokens: analysed.inputTokens,
          outputTokens: analysed.outputTokens,
          kind: draft.kind,
          language: draft.language,
          itemCount: draft.items.length,
          statedAction: draft.primaryAction,
        },
        'Brief analysed',
      );
      return analysed;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        log.warn(
          { finishReason: error.finishReason, durationMs: elapsedSince(startedAt) },
          'Model returned no valid spec draft',
        );
        throw new SiteGenerationError('invalid-output', 'The brief could not be analysed', {
          cause: error,
        });
      }
      log.error(
        { ...describeProviderError(error), durationMs: elapsedSince(startedAt) },
        'Analysis request failed',
      );
      throw requestFailed(error);
    }
  };
}
