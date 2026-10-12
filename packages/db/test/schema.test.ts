import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { SiteBrief } from '@peafowl/generator';
import { eq } from 'drizzle-orm';
import { connectDatabase, type Database } from '../src/client.ts';
import { PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, postgresError } from '../src/errors.ts';
import { runMigrations } from '../src/migrate.ts';
import {
  generations,
  ONE_ACTIVE_GENERATION_PER_PROJECT,
  projects,
  siteVersions,
  workspaces,
} from '../src/schema.ts';
import { resetDatabase, testDatabaseUrl } from '../src/testing.ts';

const BRIEF = { language: 'tr' } as unknown as SiteBrief;

const databaseUrl = testDatabaseUrl();
const connection = connectDatabase(databaseUrl);
const db: Database = connection.db;

before(() => runMigrations(databaseUrl));
beforeEach(() => resetDatabase(db));
after(() => connection.close());

/** A workspace with one project that has one completed generation and its version. */
async function siteWithVersion(slug: string) {
  const [workspace] = await db.insert(workspaces).values({ name: slug, slug }).returning();
  const [project] = await db
    .insert(projects)
    .values({ workspaceId: workspace!.id, name: slug })
    .returning();
  const [generation] = await db
    .insert(generations)
    .values({
      projectId: project!.id,
      workspaceId: workspace!.id,
      prompt: 'brief',
      status: 'completed',
    })
    .returning();
  const [version] = await db
    .insert(siteVersions)
    .values({
      projectId: project!.id,
      generationId: generation!.id,
      version: 1,
      brief: BRIEF,
      design: { format: 'html', html: '<!doctype html>' },
    })
    .returning();
  return {
    workspaceId: workspace!.id,
    projectId: project!.id,
    generationId: generation!.id,
    versionId: version!.id,
  };
}

async function assertRejected(write: Promise<unknown>, code: string, constraint: string) {
  await assert.rejects(write, (error) => {
    const cause = postgresError(error);
    assert.equal(cause?.code, code);
    assert.equal(cause?.constraint, constraint);
    return true;
  });
}

describe('references stay inside their project', () => {
  it('accepts the project’s own version as current', async () => {
    const site = await siteWithVersion('a');

    await db
      .update(projects)
      .set({ currentVersionId: site.versionId })
      .where(eq(projects.id, site.projectId));
  });

  it('refuses another project’s version as current', async () => {
    const own = await siteWithVersion('a');
    const other = await siteWithVersion('b');

    await assertRejected(
      db
        .update(projects)
        .set({ currentVersionId: other.versionId })
        .where(eq(projects.id, own.projectId)),
      PG_FOREIGN_KEY_VIOLATION,
      'projects_current_version_fk',
    );
  });

  it('refuses an edit based on another project’s version', async () => {
    const own = await siteWithVersion('a');
    const other = await siteWithVersion('b');

    await assertRejected(
      db.insert(generations).values({
        projectId: own.projectId,
        workspaceId: own.workspaceId,
        kind: 'edit',
        baseVersionId: other.versionId,
        prompt: 'change',
      }),
      PG_FOREIGN_KEY_VIOLATION,
      'generations_base_version_fk',
    );
  });

  it('refuses a version made by another project’s generation', async () => {
    const own = await siteWithVersion('a');
    const other = await siteWithVersion('b');
    await db.delete(siteVersions).where(eq(siteVersions.id, other.versionId));

    await assertRejected(
      db.insert(siteVersions).values({
        projectId: own.projectId,
        generationId: other.generationId,
        version: 2,
        brief: BRIEF,
        design: { format: 'html', html: '' },
      }),
      PG_FOREIGN_KEY_VIOLATION,
      'site_versions_generation_fk',
    );
  });

  it('refuses a generation whose workspace is not its project’s workspace', async () => {
    const own = await siteWithVersion('a');
    const other = await siteWithVersion('b');

    await assertRejected(
      db
        .insert(generations)
        .values({ projectId: own.projectId, workspaceId: other.workspaceId, prompt: 'brief' }),
      PG_FOREIGN_KEY_VIOLATION,
      'generations_project_fk',
    );
  });
});

describe('active generations', () => {
  it('allows one active generation per project, and a new one once it has finished', async () => {
    const site = await siteWithVersion('a');
    const values = { projectId: site.projectId, workspaceId: site.workspaceId, prompt: 'brief' };
    const [running] = await db.insert(generations).values(values).returning();

    await assertRejected(
      db.insert(generations).values({ ...values, status: 'awaiting_input' }),
      PG_UNIQUE_VIOLATION,
      ONE_ACTIVE_GENERATION_PER_PROJECT,
    );

    await db.update(generations).set({ status: 'failed' }).where(eq(generations.id, running!.id));
    await db.insert(generations).values(values);
  });
});

describe('deletion', () => {
  it('cascades from a workspace through projects, generations and versions', async () => {
    const site = await siteWithVersion('a');
    await db
      .update(projects)
      .set({ currentVersionId: site.versionId })
      .where(eq(projects.id, site.projectId));

    await db.delete(workspaces).where(eq(workspaces.id, site.workspaceId));

    assert.equal((await db.select().from(projects)).length, 0);
    assert.equal((await db.select().from(generations)).length, 0);
    assert.equal((await db.select().from(siteVersions)).length, 0);
  });

  it('refuses to delete a version on its own while the project points at it', async () => {
    const site = await siteWithVersion('a');
    await db
      .update(projects)
      .set({ currentVersionId: site.versionId })
      .where(eq(projects.id, site.projectId));

    await assertRejected(
      db.delete(siteVersions).where(eq(siteVersions.id, site.versionId)),
      PG_FOREIGN_KEY_VIOLATION,
      'projects_current_version_fk',
    );
  });
});
