import { workspaces, type Transaction } from '@peafowl/db';
import { eq } from 'drizzle-orm';

/**
 * Serializes quota-checked writes of one workspace. A quota check counts rows and then inserts;
 * without a lock two concurrent requests both see room and both insert. Every path that checks a
 * workspace quota must call this first, in the same transaction, so they all queue on one row.
 */
export async function lockWorkspace(tx: Transaction, workspaceId: string): Promise<void> {
  await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for('update');
}
