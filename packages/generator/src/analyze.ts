import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';
import type { LlmConfig } from './config.ts';
import { describeProviderError, requestFailed, SiteGenerationError } from './errors.ts';
import type { Logger } from '@peafowl/shared';
import type { SystemPrompt } from './prompt.ts';
import { siteBriefDraftSchema, type SiteBriefDraft } from './brief.ts';
import { elapsedSince } from './timing.ts';

export interface PromptAnalysis {
  readonly draft: SiteBriefDraft;
  readonly durationMs: number;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
}

export type AnalyzePrompt = (prompt: string, abortSignal?: AbortSignal) => Promise<PromptAnalysis>;

interface BriefAnalyzerDependencies {
  readonly model: LanguageModel;
  readonly config: Pick<LlmConfig, 'model' | 'llmTimeoutMs' | 'llmMaxRetries'>;
  readonly logger: Logger;
  readonly prompt: SystemPrompt;
}

/**
 * Step 1 of the pipeline: extracts the facts stated in a prompt into a SiteBrief draft.
 * The output is schema-validated by the SDK; completing it is code's job (see completeBrief).
 * Neither the prompt nor the extracted values are logged: they can contain contact details.
 */
export function createPromptAnalyzer({
  model,
  config,
  logger,
  prompt,
}: BriefAnalyzerDependencies): AnalyzePrompt {
  const log = logger.child({ step: 'analyze', model: config.model, promptVersion: prompt.version });

  return async (userPrompt, abortSignal) => {
    const startedAt = performance.now();
    try {
      const result = await generateText({
        model,
        system: prompt.text,
        // The prompt is user input: it is fenced and the prompt tells the model to treat it as data.
        prompt: `<brief>\n${userPrompt}\n</brief>`,
        output: Output.object({ schema: siteBriefDraftSchema, name: 'site_spec_draft' }),
        maxRetries: config.llmMaxRetries,
        abortSignal,
        timeout: { totalMs: config.llmTimeoutMs },
      });

      const draft = result.output;
      const analysis: PromptAnalysis = {
        draft,
        durationMs: elapsedSince(startedAt),
        inputTokens: result.totalUsage.inputTokens,
        outputTokens: result.totalUsage.outputTokens,
      };
      log.info(
        {
          durationMs: analysis.durationMs,
          inputTokens: analysis.inputTokens,
          outputTokens: analysis.outputTokens,
          kind: draft.kind,
          language: draft.language,
          itemCount: draft.items.length,
          statedAction: draft.primaryAction,
        },
        'Prompt analyzed',
      );
      return analysis;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        log.warn(
          { finishReason: error.finishReason, durationMs: elapsedSince(startedAt) },
          'Model returned no valid brief draft',
        );
        throw new SiteGenerationError('invalid-output', 'The prompt could not be analyzed', {
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
