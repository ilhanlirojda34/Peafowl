import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss, type DrizzleTransactionLike } from 'pg-boss';
import { z } from 'zod';

/**
 * The contract between the API (which enqueues) and the worker (which processes).
 * Jobs only carry an id: the generation row is the source of truth for state and data.
 */
export const QUEUES = {
  /** Prompt → SiteBrief draft; ends in awaiting_input or enqueues rendering. */
  analyze: 'generation-analyze',
  /** Complete SiteBrief → verified site version. */
  render: 'generation-render',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const generationJobSchema = z.object({ generationId: z.uuid() });
export type GenerationJob = z.infer<typeof generationJobSchema>;

/** Retries cover infrastructure failures; model errors are handled inside the job. */
export const JOB_RETRY_LIMIT = 2;

export async function startJobQueue(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss(databaseUrl);
  await boss.start();
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name, {
      retryLimit: JOB_RETRY_LIMIT,
      retryDelay: 10,
      retryBackoff: true,
    });
  }
  return boss;
}

/**
 * Enqueues inside the caller's transaction, so a generation row is never committed without its
 * job (or the other way round).
 */
export async function enqueueGeneration(
  boss: PgBoss,
  queue: QueueName,
  job: GenerationJob,
  transaction: DrizzleTransactionLike,
): Promise<void> {
  await boss.send(queue, job, { db: fromDrizzle(transaction, sql) });
}

export type { PgBoss };
