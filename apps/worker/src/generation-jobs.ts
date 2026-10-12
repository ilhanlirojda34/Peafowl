import {
  generations,
  projects,
  siteVersions,
  type Database,
  type GenerationErrorCode,
  type GenerationStatus,
} from '@peafowl/db';
import {
  completeBrief,
  findUnsupportedFacts,
  SiteGenerationError,
  type AnalyzePrompt,
  type WritePage,
} from '@peafowl/generator';
import { enqueueGeneration, JOB_RETRY_LIMIT, QUEUES, type PgBoss } from '@peafowl/jobs';
import type { Logger } from '@peafowl/shared';
import { and, eq, inArray, max, sql } from 'drizzle-orm';

export interface GenerationJobDependencies {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly analyzePrompt: AnalyzePrompt;
  readonly writePage: WritePage;
  readonly logger: Logger;
  readonly model: string;
  readonly promptVersion: string;
}

export interface JobAttempt {
  readonly generationId: string;
  readonly retryCount: number;
}

/**
 * Statuses a job may pick a generation up in. A retried job finds the generation where the
 * failed attempt left it, so the intermediate statuses are accepted too; anything else means
 * the job is a duplicate and is skipped.
 */
const ANALYZE_FROM: readonly GenerationStatus[] = ['queued', 'analyzing'];
const RENDER_FROM: readonly GenerationStatus[] = ['queued', 'generating', 'validating'];

export function createGenerationJobs(deps: GenerationJobDependencies) {
  const { db, logger } = deps;

  async function claim(
    generationId: string,
    from: readonly GenerationStatus[],
    to: GenerationStatus,
  ) {
    const [row] = await db
      .update(generations)
      .set({ status: to })
      .where(and(eq(generations.id, generationId), inArray(generations.status, [...from])))
      .returning();
    return row;
  }

  async function fail(generationId: string, errorCode: GenerationErrorCode): Promise<void> {
    await db
      .update(generations)
      .set({ status: 'failed', errorCode })
      .where(eq(generations.id, generationId));
  }

  /** Model errors end the generation; infrastructure errors are retried, then end it. */
  async function runSafely(attempt: JobAttempt, step: () => Promise<void>): Promise<void> {
    const log = logger.child({ generationId: attempt.generationId });
    try {
      await step();
    } catch (error) {
      if (error instanceof SiteGenerationError) {
        await fail(attempt.generationId, error.kind);
        log.warn({ errorCode: error.kind }, 'Generation failed');
        return;
      }
      if (attempt.retryCount >= JOB_RETRY_LIMIT) {
        await fail(attempt.generationId, 'internal');
        log.error({ err: error }, 'Generation failed after retries');
      }
      throw error;
    }
  }

  async function analyzeGeneration(attempt: JobAttempt): Promise<void> {
    const generation = await claim(attempt.generationId, ANALYZE_FROM, 'analyzing');
    if (generation === undefined) {
      logger.info(
        { generationId: attempt.generationId },
        'Analyze job skipped: generation not in an analyzable state',
      );
      return;
    }

    await runSafely(attempt, async () => {
      const analysis = await deps.analyzePrompt(generation.prompt);
      const completion = completeBrief(analysis.draft);

      await db.transaction(async (tx) => {
        await tx
          .update(generations)
          .set({
            draft: analysis.draft,
            status: completion.complete ? 'queued' : 'awaiting_input',
            missingFields: completion.complete ? null : completion.missing,
            inputTokens: sql`${generations.inputTokens} + ${analysis.inputTokens ?? 0}`,
            outputTokens: sql`${generations.outputTokens} + ${analysis.outputTokens ?? 0}`,
          })
          .where(eq(generations.id, generation.id));
        if (completion.complete) {
          await enqueueGeneration(deps.boss, QUEUES.render, { generationId: generation.id }, tx);
        }
      });
      logger.info(
        {
          generationId: generation.id,
          complete: completion.complete,
          missingFields: completion.complete ? [] : completion.missing,
        },
        'Prompt analyzed',
      );
    });
  }

  async function renderGeneration(attempt: JobAttempt): Promise<void> {
    const generation = await claim(attempt.generationId, RENDER_FROM, 'generating');
    const draft = generation?.draft;
    if (generation === undefined || draft == null) {
      logger.info(
        { generationId: attempt.generationId },
        'Render job skipped: generation not ready to render',
      );
      return;
    }

    await runSafely(attempt, async () => {
      const completion = completeBrief(draft);
      if (!completion.complete) throw new Error('Render job received an incomplete brief');

      const site = await deps.writePage(completion.brief);
      await claim(generation.id, ['generating'], 'validating');

      const usage = {
        model: deps.model,
        promptVersion: deps.promptVersion,
        inputTokens: sql`${generations.inputTokens} + ${site.inputTokens ?? 0}`,
        outputTokens: sql`${generations.outputTokens} + ${site.outputTokens ?? 0}`,
      };

      const unsupported = findUnsupportedFacts(site.html, completion.brief);
      if (unsupported.length > 0) {
        await db
          .update(generations)
          .set({ ...usage, status: 'failed', errorCode: 'unsupported-facts' })
          .where(eq(generations.id, generation.id));
        // Only kinds are logged: the values are model output that looks like contact data.
        logger.warn(
          { generationId: generation.id, kinds: unsupported.map((fact) => fact.kind) },
          'Generated site rejected: facts not in the brief',
        );
        return;
      }

      const version = await db.transaction(async (tx) => {
        const [latest] = await tx
          .select({ version: max(siteVersions.version) })
          .from(siteVersions)
          .where(eq(siteVersions.projectId, generation.projectId));
        const [created] = await tx
          .insert(siteVersions)
          .values({
            projectId: generation.projectId,
            generationId: generation.id,
            version: (latest?.version ?? 0) + 1,
            brief: completion.brief,
            design: { format: 'html', html: site.html },
          })
          .returning({ id: siteVersions.id, version: siteVersions.version });
        if (created === undefined) throw new Error('Site version insert returned no row');
        await tx
          .update(generations)
          .set({ ...usage, status: 'completed' })
          .where(eq(generations.id, generation.id));
        await tx
          .update(projects)
          .set({ currentVersionId: created.id })
          .where(eq(projects.id, generation.projectId));
        return created;
      });
      logger.info(
        { generationId: generation.id, siteVersionId: version.id, version: version.version },
        'Site version created',
      );
    });
  }

  return { analyzeGeneration, renderGeneration };
}
