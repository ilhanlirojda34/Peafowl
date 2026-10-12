import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  connectDatabase,
  generations,
  projects,
  runMigrations,
  siteVersions,
  workspaces,
} from '@peafowl/db';
import { resetDatabase, testDatabaseUrl } from '@peafowl/db/testing';
import {
  SiteGenerationError,
  type AnalyzePrompt,
  type WritePage,
  type SiteBriefDraft,
} from '@peafowl/generator';
import { QUEUES, startJobQueue, type PgBoss } from '@peafowl/jobs';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { createGenerationJobs } from '../src/generation-jobs.ts';

const COMPLETE_DRAFT: SiteBriefDraft = {
  kind: 'business',
  language: 'tr',
  subject: {
    name: 'Moda Kahve',
    category: 'kahve dükkanı',
    location: 'Kadıköy',
    summary: null,
    schedule: null,
  },
  items: [],
  contact: { phone: '0216 555 12 34', email: null, address: null, url: null },
  primaryAction: null,
  tone: 'friendly',
};
const DRAFT_WITHOUT_NAME: SiteBriefDraft = {
  ...COMPLETE_DRAFT,
  subject: { ...COMPLETE_DRAFT.subject, name: null },
};
const PAGE =
  '<!doctype html><html lang="tr"><body><h1>Moda Kahve</h1><a href="tel:02165551234">Ara</a></body></html>';

const databaseUrl = testDatabaseUrl();
const connection = connectDatabase(databaseUrl);
const db = connection.db;
let boss: PgBoss;

before(async () => {
  await runMigrations(databaseUrl);
  boss = await startJobQueue(databaseUrl);
});

beforeEach(async () => {
  await resetDatabase(db);
  for (const queue of Object.values(QUEUES)) await boss.deleteAllJobs(queue);
});

after(async () => {
  await boss.stop();
  await connection.close();
});

function analyzerReturning(draft: SiteBriefDraft): AnalyzePrompt {
  return async () => ({ draft, durationMs: 1, inputTokens: 100, outputTokens: 50 });
}

function pageWriterReturning(html: string): WritePage {
  return async () => ({ html, durationMs: 1, inputTokens: 200, outputTokens: 900 });
}

function jobsWith(analyzePrompt: AnalyzePrompt, writePage: WritePage = pageWriterReturning(PAGE)) {
  return createGenerationJobs({
    db,
    boss,
    analyzePrompt,
    writePage,
    logger: pino({ level: 'silent' }),
    model: 'mock',
    promptVersion: 'test',
  });
}

async function queuedGeneration(): Promise<string> {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'Moda Kahve', slug: 'moda-kahve' })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ workspaceId: workspace!.id, name: 'Moda Kahve' })
    .returning();
  const [generation] = await db
    .insert(generations)
    .values({
      projectId: project!.id,
      workspaceId: workspace!.id,
      prompt: "Kadıköy'de kahve dükkanı",
    })
    .returning();
  return generation!.id;
}

async function load(generationId: string) {
  const [row] = await db.select().from(generations).where(eq(generations.id, generationId));
  assert.ok(row);
  return row;
}

describe('analyzeGeneration', () => {
  it('waits for the user when critical fields are missing', async () => {
    const generationId = await queuedGeneration();

    await jobsWith(analyzerReturning(DRAFT_WITHOUT_NAME)).analyzeGeneration({
      generationId,
      retryCount: 0,
    });

    const generation = await load(generationId);
    assert.equal(generation.status, 'awaiting_input');
    assert.deepEqual(generation.missingFields, ['name']);
    assert.equal(generation.inputTokens, 100);
    assert.equal((await boss.fetch(QUEUES.render)).length, 0);
  });

  it('queues rendering when the brief is complete', async () => {
    const generationId = await queuedGeneration();

    await jobsWith(analyzerReturning(COMPLETE_DRAFT)).analyzeGeneration({
      generationId,
      retryCount: 0,
    });

    assert.equal((await load(generationId)).status, 'queued');
    const [job] = await boss.fetch(QUEUES.render);
    assert.deepEqual(job?.data, { generationId });
  });

  it('marks the generation failed when the model call fails', async () => {
    const generationId = await queuedGeneration();
    const failing: AnalyzePrompt = async () => {
      throw new SiteGenerationError('request-failed', 'quota exceeded');
    };

    await jobsWith(failing).analyzeGeneration({ generationId, retryCount: 0 });

    const generation = await load(generationId);
    assert.equal(generation.status, 'failed');
    assert.equal(generation.errorCode, 'request-failed');
  });

  it('skips a duplicate job for a generation that already moved on', async () => {
    const generationId = await queuedGeneration();
    await db
      .update(generations)
      .set({ status: 'completed' })
      .where(eq(generations.id, generationId));
    let called = false;
    const spy: AnalyzePrompt = async (prompt) => {
      called = true;
      return analyzerReturning(COMPLETE_DRAFT)(prompt);
    };

    await jobsWith(spy).analyzeGeneration({ generationId, retryCount: 0 });

    assert.equal(called, false);
    assert.equal((await load(generationId)).status, 'completed');
  });
});

describe('renderGeneration', () => {
  async function readyToRender(): Promise<string> {
    const generationId = await queuedGeneration();
    await db
      .update(generations)
      .set({ draft: COMPLETE_DRAFT })
      .where(eq(generations.id, generationId));
    return generationId;
  }

  it('stores a verified site as the next version of the project', async () => {
    const generationId = await readyToRender();

    await jobsWith(analyzerReturning(COMPLETE_DRAFT)).renderGeneration({
      generationId,
      retryCount: 0,
    });

    const generation = await load(generationId);
    assert.equal(generation.status, 'completed');
    assert.equal(generation.outputTokens, 900);
    const [version] = await db
      .select()
      .from(siteVersions)
      .where(eq(siteVersions.generationId, generationId));
    assert.equal(version?.version, 1);
    assert.deepEqual(version?.design, { format: 'html', html: PAGE });
    const [project] = await db.select().from(projects).where(eq(projects.id, generation.projectId));
    assert.equal(project?.currentVersionId, version?.id);
  });

  it('rejects a site with facts that are not in the brief', async () => {
    const generationId = await readyToRender();
    const invented = PAGE.replace('tel:02165551234', 'tel:+902129998877');

    await jobsWith(
      analyzerReturning(COMPLETE_DRAFT),
      pageWriterReturning(invented),
    ).renderGeneration({
      generationId,
      retryCount: 0,
    });

    const generation = await load(generationId);
    assert.equal(generation.status, 'failed');
    assert.equal(generation.errorCode, 'unsupported-facts');
    assert.equal((await db.select().from(siteVersions)).length, 0);
  });

  it('retries an infrastructure error and gives up after the retry limit', async () => {
    const generationId = await readyToRender();
    const broken: WritePage = async () => {
      throw new Error('connection reset');
    };
    const jobs = jobsWith(analyzerReturning(COMPLETE_DRAFT), broken);

    await assert.rejects(jobs.renderGeneration({ generationId, retryCount: 0 }));
    assert.equal((await load(generationId)).status, 'generating');

    await assert.rejects(jobs.renderGeneration({ generationId, retryCount: 2 }));
    const generation = await load(generationId);
    assert.equal(generation.status, 'failed');
    assert.equal(generation.errorCode, 'internal');
  });
});
