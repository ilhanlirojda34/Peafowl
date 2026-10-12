import { projects, siteVersions, type Database } from '@peafowl/db';
import { renderDesign } from '@peafowl/generator';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound, parseInput } from '../../http.ts';
import { accessibleProject, assertProjectAccess } from '../workspaces/project-access.ts';

const projectParams = z.object({ projectId: z.uuid() });
const versionParams = z.object({ siteVersionId: z.uuid() });

export async function siteVersionRoutes(app: FastifyInstance, { db }: { readonly db: Database }) {
  app.get('/projects/:projectId/site-versions', async (request) => {
    const { projectId } = parseInput(projectParams, request.params);
    await assertProjectAccess(db, request.auth.workspaceId, projectId);
    return db
      .select({
        id: siteVersions.id,
        version: siteVersions.version,
        generationId: siteVersions.generationId,
        createdAt: siteVersions.createdAt,
      })
      .from(siteVersions)
      .where(eq(siteVersions.projectId, projectId))
      .orderBy(desc(siteVersions.version));
  });

  /**
   * Returns the generated HTML as data. The web app must show it in an iframe with
   * `sandbox="allow-scripts"` and without `allow-same-origin`, so the generated page runs in an
   * opaque origin and cannot reach the app's session (D10).
   */
  app.get('/site-versions/:siteVersionId', async (request) => {
    const { siteVersionId } = parseInput(versionParams, request.params);
    const [version] = await db
      .select({
        id: siteVersions.id,
        projectId: siteVersions.projectId,
        version: siteVersions.version,
        design: siteVersions.design,
        createdAt: siteVersions.createdAt,
      })
      .from(siteVersions)
      .innerJoin(projects, eq(projects.id, siteVersions.projectId))
      .where(
        and(
          eq(siteVersions.id, siteVersionId),
          accessibleProject(request.auth.workspaceId, siteVersions.projectId),
        ),
      );
    if (version === undefined) throw notFound('Site version');
    const { design, ...metadata } = version;
    return { ...metadata, html: renderDesign(design) };
  });
}
