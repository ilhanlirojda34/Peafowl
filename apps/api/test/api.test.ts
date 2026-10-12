import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  connectDatabase,
  generations,
  projects,
  runMigrations,
  siteVersions,
  users,
  workspaceMembers,
} from '@peafowl/db';
import type { SiteBrief, SiteBriefDraft } from '@peafowl/generator';
import { resetDatabase, testDatabaseUrl } from '@peafowl/db/testing';
import { QUEUES, startJobQueue, type PgBoss } from '@peafowl/jobs';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { buildApp } from '../src/app.ts';

const OWNER = { 'x-dev-user-email': 'owner@example.com' };
const STRANGER = { 'x-dev-user-email': 'stranger@example.com' };
const PROMPT = "Kadıköy'de bir kahve dükkanı için tanıtım sitesi";
const PROJECT_LIMIT = 3;
const CREATE_LIMIT = 2;

const databaseUrl = testDatabaseUrl();
const connection = connectDatabase(databaseUrl);
let boss: PgBoss;
let app: Awaited<ReturnType<typeof buildApp>>;

before(async () => {
  await runMigrations(databaseUrl);
  boss = await startJobQueue(databaseUrl);
  app = await buildApp({
    db: connection.db,
    boss,
    logger: pino({ level: 'silent' }),
    freePlanProjectLimit: PROJECT_LIMIT,
    freePlanGenerationQuotas: [
      { kinds: ['create'], limit: CREATE_LIMIT, windowDays: null },
      { kinds: ['edit'], limit: 0, windowDays: null },
    ],
  });
});

beforeEach(async () => {
  await resetDatabase(connection.db);
  for (const queue of Object.values(QUEUES)) await boss.deleteAllJobs(queue);
});

after(async () => {
  await app.close();
  await boss.stop();
  await connection.close();
});

async function createProject(headers = OWNER) {
  const response = await app.inject({
    method: 'POST',
    url: '/projects',
    headers,
    payload: { name: 'Moda Kahve' },
  });
  assert.equal(response.statusCode, 201);
  return response.json<{ id: string }>();
}

function startGeneration(projectId: string) {
  return app.inject({
    method: 'POST',
    url: `/projects/${projectId}/generations`,
    headers: OWNER,
    payload: { prompt: PROMPT },
  });
}

async function createGeneration(projectId: string) {
  const response = await startGeneration(projectId);
  assert.equal(response.statusCode, 202);
  return response.json<{ id: string; status: string }>();
}

async function finishGeneration(generationId: string, status: 'completed' | 'failed') {
  await connection.db.update(generations).set({ status }).where(eq(generations.id, generationId));
}

function statusCounts(responses: readonly { statusCode: number }[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const { statusCode } of responses) counts[statusCode] = (counts[statusCode] ?? 0) + 1;
  return counts;
}

describe('authentication', () => {
  it('rejects requests without a user', async () => {
    const response = await app.inject({ method: 'GET', url: '/projects' });
    assert.equal(response.statusCode, 401);
  });

  it('creates the user with a personal workspace once', async () => {
    await app.inject({ method: 'GET', url: '/projects', headers: OWNER });
    await app.inject({ method: 'GET', url: '/projects', headers: OWNER });

    const memberships = await connection.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(users.email, 'owner@example.com'));
    assert.deepEqual(memberships, [{ role: 'owner' }]);
  });
});

describe('projects', () => {
  it('lists only the caller’s projects and hides others', async () => {
    const project = await createProject();

    const own = await app.inject({ method: 'GET', url: '/projects', headers: OWNER });
    const foreign = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}`,
      headers: STRANGER,
    });

    assert.equal(own.json<unknown[]>().length, 1);
    assert.equal(foreign.statusCode, 404);
  });

  it('enforces the free plan project limit', async () => {
    for (let created = 0; created < PROJECT_LIMIT; created++) await createProject();

    const third = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: OWNER,
      payload: { name: 'Üçüncü' },
    });

    assert.equal(third.statusCode, 403);
    assert.equal(third.json<{ error: string }>().error, 'quota-exceeded');
  });

  it('soft-deletes a project, which frees its slot in the plan', async () => {
    const first = await createProject();
    for (let created = 1; created < PROJECT_LIMIT; created++) await createProject();

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/projects/${first.id}`,
      headers: OWNER,
    });
    const gone = await app.inject({ method: 'GET', url: `/projects/${first.id}`, headers: OWNER });

    assert.equal(deleted.statusCode, 204);
    assert.equal(gone.statusCode, 404);
    await createProject();
  });

  it('does not exceed the project limit under concurrent requests', async () => {
    await app.inject({ method: 'GET', url: '/projects', headers: OWNER }); // signs the user up

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        app.inject({ method: 'POST', url: '/projects', headers: OWNER, payload: { name: 'Site' } }),
      ),
    );

    assert.deepEqual(statusCounts(responses), { 201: PROJECT_LIMIT, 403: 6 - PROJECT_LIMIT });
  });

  it('validates the request body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: OWNER,
      payload: { name: '' },
    });
    assert.equal(response.statusCode, 400);
  });
});

describe('generations', () => {
  it('queues a generation together with its analyze job', async () => {
    const project = await createProject();

    const generation = await createGeneration(project.id);

    assert.equal(generation.status, 'queued');
    const [job] = await boss.fetch(QUEUES.analyze);
    assert.deepEqual(job?.data, { generationId: generation.id });
  });

  it('allows one generation in progress per project, also under concurrent requests', async () => {
    const project = await createProject();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => startGeneration(project.id)),
    );

    assert.deepEqual(statusCounts(responses), { 202: 1, 409: 4 });
  });

  it('allows a new generation once the previous one has finished', async () => {
    const project = await createProject();
    const first = await createGeneration(project.id);
    await finishGeneration(first.id, 'completed');

    await createGeneration(project.id);
  });

  it('rejects a prompt that is too short and a project of another workspace', async () => {
    const project = await createProject();

    const short = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/generations`,
      headers: OWNER,
      payload: { prompt: 'site' },
    });
    const foreign = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/generations`,
      headers: STRANGER,
      payload: { prompt: PROMPT },
    });

    assert.equal(short.statusCode, 400);
    assert.equal(foreign.statusCode, 404);
  });

  it('records concurrent answers without losing any of them', async () => {
    const project = await createProject();
    const generation = await createGeneration(project.id);
    await connection.db
      .update(generations)
      .set({
        status: 'awaiting_input',
        draft: DRAFT_WITHOUT_NAME,
        missingFields: ['name', 'contact'],
      })
      .where(eq(generations.id, generation.id));

    const responses = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/generations/${generation.id}/answers`,
        headers: OWNER,
        payload: { answers: { name: 'Moda Kahve' } },
      }),
      app.inject({
        method: 'POST',
        url: `/generations/${generation.id}/answers`,
        headers: OWNER,
        payload: { answers: { phone: '0216 555 12 34' } },
      }),
    ]);

    assert.deepEqual(statusCounts(responses), { 200: 2 });
    const [stored] = await connection.db
      .select({
        status: generations.status,
        draft: generations.draft,
        answers: generations.answers,
      })
      .from(generations)
      .where(eq(generations.id, generation.id));
    assert.equal(stored?.answers.length, 2);
    assert.equal(stored?.draft?.subject.name, 'Moda Kahve');
    assert.equal(stored?.draft?.contact.phone, '0216 555 12 34');
    assert.equal(stored?.status, 'queued');
    assert.equal((await boss.fetch(QUEUES.render, { batchSize: 5 })).length, 1);
  });

  it('asks questions, rejects invalid answers and queues rendering once complete', async () => {
    const project = await createProject();
    const generation = await createGeneration(project.id);
    await connection.db
      .update(generations)
      .set({
        status: 'awaiting_input',
        draft: DRAFT_WITHOUT_NAME,
        missingFields: ['name', 'contact'],
      })
      .where(eq(generations.id, generation.id));

    const waiting = await app.inject({
      method: 'GET',
      url: `/generations/${generation.id}`,
      headers: OWNER,
    });
    assert.deepEqual(
      waiting.json<{ questions: { field: string }[] }>().questions.map((q) => q.field),
      ['name', 'contact'],
    );

    const invalid = await app.inject({
      method: 'POST',
      url: `/generations/${generation.id}/answers`,
      headers: OWNER,
      payload: { answers: { name: 'Moda Kahve', email: 'not-an-email' } },
    });
    assert.equal(invalid.statusCode, 422);

    const valid = await app.inject({
      method: 'POST',
      url: `/generations/${generation.id}/answers`,
      headers: OWNER,
      payload: { answers: { name: 'Moda Kahve', phone: '0216 555 12 34' } },
    });
    assert.equal(valid.json<{ status: string }>().status, 'queued');
    const [job] = await boss.fetch(QUEUES.render);
    assert.deepEqual(job?.data, { generationId: generation.id });
    const [stored] = await connection.db
      .select({ answers: generations.answers })
      .from(generations)
      .where(eq(generations.id, generation.id));
    assert.deepEqual(
      stored?.answers.map((record) => record.answers),
      [{ name: 'Moda Kahve', phone: '0216 555 12 34' }],
    );

    const again = await app.inject({
      method: 'POST',
      url: `/generations/${generation.id}/answers`,
      headers: OWNER,
      payload: { answers: { name: 'Moda Kahve' } },
    });
    assert.equal(again.statusCode, 409);
  });
});

const DRAFT_WITHOUT_NAME: SiteBriefDraft = {
  kind: 'business',
  language: 'tr',
  subject: {
    name: null,
    category: 'kahve dükkanı',
    location: 'Kadıköy',
    summary: null,
    schedule: null,
  },
  items: [],
  contact: { phone: null, email: null, address: null, url: null },
  primaryAction: null,
  tone: 'friendly',
};

describe('generation quota', () => {
  it('counts generations of deleted projects', async () => {
    const deleted = await createProject();
    const first = await createGeneration(deleted.id);
    await finishGeneration(first.id, 'completed');
    await app.inject({ method: 'DELETE', url: `/projects/${deleted.id}`, headers: OWNER });

    const second = await createProject();
    await createGeneration(second.id);
    const third = await createProject();
    const refused = await startGeneration(third.id);

    assert.equal(refused.statusCode, 403);
    assert.equal(refused.json<{ error: string }>().error, 'quota-exceeded');
  });

  it('does not count failed generations', async () => {
    const project = await createProject();
    for (let attempt = 0; attempt < CREATE_LIMIT + 1; attempt++) {
      const generation = await createGeneration(project.id);
      await finishGeneration(generation.id, 'failed');
    }
  });

  it('is not exceeded by concurrent requests across projects', async () => {
    const projectIds: string[] = [];
    for (let created = 0; created < PROJECT_LIMIT; created++) {
      projectIds.push((await createProject()).id);
    }

    const responses = await Promise.all(projectIds.map((id) => startGeneration(id)));

    assert.deepEqual(statusCounts(responses), {
      202: CREATE_LIMIT,
      403: PROJECT_LIMIT - CREATE_LIMIT,
    });
  });
});

describe('site versions', () => {
  const PAGE = '<!doctype html><html lang="tr"><body><h1>Moda Kahve</h1></body></html>';

  /** Stores a version the way the worker does for a model-written page. */
  async function storedVersion() {
    const project = await createProject();
    const generation = await createGeneration(project.id);
    await finishGeneration(generation.id, 'completed');
    const [version] = await connection.db
      .insert(siteVersions)
      .values({
        projectId: project.id,
        generationId: generation.id,
        version: 1,
        brief: { schemaVersion: 1 } as SiteBrief,
        design: { format: 'html', html: PAGE },
      })
      .returning({ id: siteVersions.id });
    await connection.db
      .update(projects)
      .set({ currentVersionId: version!.id })
      .where(eq(projects.id, project.id));
    return { projectId: project.id, versionId: version!.id };
  }

  it('serves a model-written page as its HTML for preview', async () => {
    const { projectId, versionId } = await storedVersion();

    const list = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/site-versions`,
      headers: OWNER,
    });
    const preview = await app.inject({
      method: 'GET',
      url: `/site-versions/${versionId}`,
      headers: OWNER,
    });

    assert.deepEqual(
      list.json<{ id: string }[]>().map((version) => version.id),
      [versionId],
    );
    const body = preview.json<Record<string, unknown>>();
    assert.equal(body.html, PAGE);
    assert.equal('design' in body, false);
    assert.equal('brief' in body, false);
  });

  it('hides versions of other workspaces', async () => {
    const { projectId, versionId } = await storedVersion();

    const list = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/site-versions`,
      headers: STRANGER,
    });
    const preview = await app.inject({
      method: 'GET',
      url: `/site-versions/${versionId}`,
      headers: STRANGER,
    });

    assert.equal(list.statusCode, 404);
    assert.equal(preview.statusCode, 404);
  });
});
