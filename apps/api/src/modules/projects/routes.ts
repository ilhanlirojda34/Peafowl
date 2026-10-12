import { projects, type Database } from '@peafowl/db';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, notFound, parseInput } from '../../http.ts';
import { accessibleProject } from '../workspaces/project-access.ts';
import { lockWorkspace } from '../workspaces/workspace-lock.ts';

const createProjectBody = z.object({ name: z.string().trim().min(1).max(80) });
const projectParams = z.object({ projectId: z.uuid() });

const projectColumns = {
  id: projects.id,
  name: projects.name,
  currentVersionId: projects.currentVersionId,
  createdAt: projects.createdAt,
};

interface ProjectRoutesOptions {
  readonly db: Database;
  readonly freePlanProjectLimit: number;
}

export async function projectRoutes(
  app: FastifyInstance,
  { db, freePlanProjectLimit }: ProjectRoutesOptions,
) {
  app.post('/projects', async (request, reply) => {
    const { name } = parseInput(createProjectBody, request.body);
    const { userId, workspaceId } = request.auth;

    // Deleted projects free their slot: this limit bounds stored sites, not model usage.
    const project = await db.transaction(async (tx) => {
      await lockWorkspace(tx, workspaceId);
      const [active] = await tx
        .select({ total: count() })
        .from(projects)
        .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)));
      if ((active?.total ?? 0) >= freePlanProjectLimit) {
        throw new HttpError(
          403,
          'quota-exceeded',
          `The free plan allows ${freePlanProjectLimit} sites`,
        );
      }
      const [created] = await tx
        .insert(projects)
        .values({ workspaceId, name, createdById: userId })
        .returning(projectColumns);
      return created;
    });
    request.log.info({ projectId: project?.id, workspaceId }, 'Project created');
    return reply.status(201).send(project);
  });

  app.get('/projects', async (request) => {
    return db
      .select(projectColumns)
      .from(projects)
      .where(and(eq(projects.workspaceId, request.auth.workspaceId), isNull(projects.deletedAt)))
      .orderBy(desc(projects.createdAt));
  });

  app.get('/projects/:projectId', async (request) => {
    const { projectId } = parseInput(projectParams, request.params);
    const [project] = await db
      .select(projectColumns)
      .from(projects)
      .where(accessibleProject(request.auth.workspaceId, projectId));
    if (project === undefined) throw notFound('Project');
    return project;
  });

  /** Soft delete: the project disappears for the user; its versions stay for restore. */
  app.delete('/projects/:projectId', async (request, reply) => {
    const { projectId } = parseInput(projectParams, request.params);
    const [deleted] = await db
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(accessibleProject(request.auth.workspaceId, projectId))
      .returning({ id: projects.id });
    if (deleted === undefined) throw notFound('Project');
    request.log.info({ projectId }, 'Project deleted');
    return reply.status(204).send();
  });
}
