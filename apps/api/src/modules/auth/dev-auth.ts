import { randomBytes } from 'node:crypto';
import { users, workspaceMembers, workspaces, type Database } from '@peafowl/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../../http.ts';
import type { AuthContext } from './context.ts';

const DEV_USER_HEADER = 'x-dev-user-email';
const emailSchema = z.email().max(254);

/**
 * Development sign-in: the caller names a user by email header. On first use the user and their
 * personal workspace are created. It exists so the API can be built and tested before real
 * authentication; the config refuses to enable it in production. Registered on the root
 * instance, so it guards every route.
 */
export function registerDevAuth(app: FastifyInstance, db: Database): void {
  app.decorateRequest('auth');
  app.addHook('onRequest', async (request) => {
    const parsed = emailSchema.safeParse(request.headers[DEV_USER_HEADER]);
    if (!parsed.success) {
      throw new HttpError(401, 'unauthenticated', `Send a valid ${DEV_USER_HEADER} header`);
    }
    request.auth = await signIn(db, parsed.data.toLowerCase());
  });
}

async function signIn(db: Database, email: string): Promise<AuthContext> {
  const [existing] = await db
    .select({ userId: users.id, workspaceId: workspaceMembers.workspaceId })
    .from(users)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.userId, users.id), eq(workspaceMembers.role, 'owner')),
    )
    .where(eq(users.email, email))
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1);
  if (existing !== undefined) return existing;

  return db.transaction(async (tx) => {
    const name = email.split('@')[0] ?? email;
    const [user] = await tx.insert(users).values({ email, name }).returning({ id: users.id });
    const [workspace] = await tx
      .insert(workspaces)
      .values({ name, slug: personalSlug(name) })
      .returning({ id: workspaces.id });
    if (user === undefined || workspace === undefined)
      throw new Error('Sign-up insert returned no row');
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user.id, role: 'owner' });
    return { userId: user.id, workspaceId: workspace.id };
  });
}

/** URL-safe and unique without a lookup: the name part is readable, the suffix avoids clashes. */
function personalSlug(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'workspace';
  return `${base}-${randomBytes(3).toString('hex')}`;
}
