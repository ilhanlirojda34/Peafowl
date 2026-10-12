import { GENERATION_KINDS, generations, type GenerationKind, type Transaction } from '@peafowl/db';
import { and, count, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError } from '../../http.ts';

/**
 * How many generations a workspace may start. A rule limits the kinds it lists together, so
 * create and edit can share one allowance or have their own. `windowDays` makes the limit
 * rolling (the last N days); null makes it lifetime. Every rule that covers a kind must pass.
 */
export const generationQuotaRulesSchema = z
  .array(
    z.strictObject({
      kinds: z.array(z.enum(GENERATION_KINDS)).min(1),
      limit: z.number().int().min(0),
      windowDays: z.number().int().min(1).nullable(),
    }),
  )
  .refine(
    (rules) => GENERATION_KINDS.every((kind) => rules.some((rule) => rule.kinds.includes(kind))),
    { message: `Every generation kind (${GENERATION_KINDS.join(', ')}) needs a rule` },
  );

export type GenerationQuotaRules = z.infer<typeof generationQuotaRulesSchema>;

/**
 * Throws when starting a generation of this kind would exceed a rule. Generations of deleted
 * projects count, so deleting a project never gives an allowance back. Failed generations do not
 * count: a failure is the platform's, not the user's.
 *
 * The caller must hold the workspace lock (lockWorkspace) in this transaction, or concurrent
 * requests can both pass the check.
 */
export async function assertGenerationQuota(
  tx: Transaction,
  workspaceId: string,
  kind: GenerationKind,
  rules: GenerationQuotaRules,
): Promise<void> {
  for (const rule of rules.filter((candidate) => candidate.kinds.includes(kind))) {
    const [usage] = await tx
      .select({ used: count() })
      .from(generations)
      .where(
        and(
          eq(generations.workspaceId, workspaceId),
          inArray(generations.kind, rule.kinds),
          ne(generations.status, 'failed'),
          rule.windowDays === null
            ? undefined
            : gt(generations.createdAt, sql`now() - make_interval(days => ${rule.windowDays})`),
        ),
      );
    if ((usage?.used ?? 0) >= rule.limit) {
      throw new HttpError(403, 'quota-exceeded', 'The generation limit of your plan is reached', {
        kinds: rule.kinds,
        limit: rule.limit,
        windowDays: rule.windowDays,
      });
    }
  }
}
