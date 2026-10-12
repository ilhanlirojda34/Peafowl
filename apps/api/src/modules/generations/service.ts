import {
  generations,
  isUniqueViolation,
  ONE_ACTIVE_GENERATION_PER_PROJECT,
  projects,
  siteVersions,
  type AnswerRecord,
  type Database,
  type DatabaseExecutor,
  type GenerationKind,
} from '@peafowl/db';
import {
  ANSWER_LABELS,
  applyAnswers,
  completeBrief,
  questionsFor,
  type Answers,
} from '@peafowl/generator';
import { enqueueGeneration, QUEUES, type PgBoss } from '@peafowl/jobs';
import { and, eq } from 'drizzle-orm';
import { HttpError, notFound } from '../../http.ts';
import type { AuthContext } from '../auth/context.ts';
import { accessibleProject, assertProjectAccess } from '../workspaces/project-access.ts';
import { lockWorkspace } from '../workspaces/workspace-lock.ts';
import { assertGenerationQuota, type GenerationQuotaRules } from './quota.ts';

type GenerationRow = typeof generations.$inferSelect;

/** What the client sees of a generation. The draft stays server-side; questions are derived from it. */
export interface GenerationView {
  readonly id: string;
  readonly projectId: string;
  readonly kind: GenerationRow['kind'];
  readonly status: GenerationRow['status'];
  readonly errorCode: GenerationRow['errorCode'];
  readonly questions: readonly {
    readonly field: string;
    readonly prompt: string;
    readonly inputs: readonly { readonly field: string; readonly label: string }[];
  }[];
  readonly siteVersionId: string | null;
  readonly createdAt: Date;
}

interface NewGeneration {
  readonly projectId: string;
  readonly kind: GenerationKind;
  readonly prompt: string;
}

export class GenerationService {
  readonly #db: Database;
  readonly #boss: PgBoss;
  readonly #quotaRules: GenerationQuotaRules;

  constructor(db: Database, boss: PgBoss, quotaRules: GenerationQuotaRules) {
    this.#db = db;
    this.#boss = boss;
    this.#quotaRules = quotaRules;
  }

  async create(auth: AuthContext, projectId: string, prompt: string): Promise<GenerationView> {
    const generation = await this.#start(auth, { projectId, kind: 'create', prompt });
    return this.#toView(generation, null);
  }

  async get(auth: AuthContext, generationId: string): Promise<GenerationView> {
    const generation = await this.#findAccessible(this.#db, auth, generationId);
    const [version] = await this.#db
      .select({ id: siteVersions.id })
      .from(siteVersions)
      .where(eq(siteVersions.generationId, generationId));
    return this.#toView(generation, version?.id ?? null);
  }

  /**
   * Applies the user's answers and records them. When the brief is complete the generation goes
   * back to the queue for rendering; otherwise it keeps waiting with the remaining questions.
   * The generation row is locked while the answers are merged, so concurrent submissions are
   * applied one after the other and none of them is lost.
   */
  async answer(auth: AuthContext, generationId: string, answers: Answers): Promise<GenerationView> {
    const updated = await this.#db.transaction(async (tx) => {
      const generation = await this.#findAccessible(tx, auth, generationId, { lock: true });
      if (generation.status !== 'awaiting_input' || generation.draft === null) {
        throw new HttpError(409, 'conflict', 'This generation is not waiting for answers');
      }

      const result = applyAnswers(generation.draft, answers);
      if (!result.ok) {
        throw new HttpError(422, 'invalid-answers', 'Some answers are not valid', {
          fields: result.invalidFields,
        });
      }
      const completion = completeBrief(result.draft);
      const record: AnswerRecord = { answers, answeredAt: new Date().toISOString() };

      const [row] = await tx
        .update(generations)
        .set({
          draft: result.draft,
          answers: [...generation.answers, record],
          status: completion.complete ? 'queued' : 'awaiting_input',
          missingFields: completion.complete ? null : completion.missing,
        })
        .where(eq(generations.id, generationId))
        .returning();
      if (row === undefined) throw new Error('Generation update returned no row');
      if (completion.complete) {
        await enqueueGeneration(this.#boss, QUEUES.render, { generationId }, tx);
      }
      return row;
    });
    return this.#toView(updated, null);
  }

  /**
   * The only way a generation is created, so every kind goes through the same workspace lock,
   * quota check and one-active-generation rule. The partial unique index enforces that rule;
   * a conflict means another generation of the project is still running.
   */
  async #start(auth: AuthContext, generation: NewGeneration): Promise<GenerationRow> {
    try {
      return await this.#db.transaction(async (tx) => {
        await lockWorkspace(tx, auth.workspaceId);
        await assertProjectAccess(tx, auth.workspaceId, generation.projectId);
        await assertGenerationQuota(tx, auth.workspaceId, generation.kind, this.#quotaRules);

        const [row] = await tx
          .insert(generations)
          .values({ ...generation, workspaceId: auth.workspaceId, createdById: auth.userId })
          .returning();
        if (row === undefined) throw new Error('Generation insert returned no row');
        await enqueueGeneration(this.#boss, QUEUES.analyze, { generationId: row.id }, tx);
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error, ONE_ACTIVE_GENERATION_PER_PROJECT)) {
        throw new HttpError(409, 'conflict', 'This project already has a generation in progress');
      }
      throw error;
    }
  }

  async #findAccessible(
    executor: DatabaseExecutor,
    auth: AuthContext,
    generationId: string,
    { lock = false } = {},
  ): Promise<GenerationRow> {
    const query = executor
      .select({ generation: generations })
      .from(generations)
      .innerJoin(projects, eq(projects.id, generations.projectId))
      .where(
        and(
          eq(generations.id, generationId),
          accessibleProject(auth.workspaceId, generations.projectId),
        ),
      );
    const [row] = lock ? await query.for('update', { of: generations }) : await query;
    if (row === undefined) throw notFound('Generation');
    return row.generation;
  }

  #toView(generation: GenerationRow, siteVersionId: string | null): GenerationView {
    const language = generation.draft?.language ?? 'tr';
    const questions =
      generation.status === 'awaiting_input' && generation.missingFields !== null
        ? questionsFor(generation.missingFields, language).map((question) => ({
            field: question.field,
            prompt: question.prompt,
            inputs: question.inputs.map((field) => ({
              field,
              label: ANSWER_LABELS[language][field],
            })),
          }))
        : [];
    return {
      id: generation.id,
      projectId: generation.projectId,
      kind: generation.kind,
      status: generation.status,
      errorCode: generation.errorCode,
      questions,
      siteVersionId,
      createdAt: generation.createdAt,
    };
  }
}
