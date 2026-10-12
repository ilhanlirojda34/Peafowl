import { projects, type DatabaseExecutor } from '@peafowl/db';
import { and, eq, isNull, type SQLWrapper } from 'drizzle-orm';
import { notFound } from '../../http.ts';

/**
 * The single ownership rule for project data: the project must belong to the caller's workspace
 * and must not be deleted. Anything else is reported as not found, so ids of other workspaces
 * cannot be probed. `projectId` may be a column, for joins.
 */
export function accessibleProject(workspaceId: string, projectId: string | SQLWrapper) {
  return and(
    eq(projects.id, projectId),
    eq(projects.workspaceId, workspaceId),
    isNull(projects.deletedAt),
  );
}

export async function assertProjectAccess(
  db: DatabaseExecutor,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(accessibleProject(workspaceId, projectId));
  if (project === undefined) throw notFound('Project');
}
