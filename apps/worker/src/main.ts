import { connectDatabase } from '@peafowl/db';
import {
  createPromptAnalyzer,
  createGeminiModel,
  createPageWriter,
  loadSystemPrompt,
} from '@peafowl/generator';
import { generationJobSchema, QUEUES, startJobQueue } from '@peafowl/jobs';
import { createLogger } from '@peafowl/shared';
import { loadWorkerConfig } from './config.ts';
import { createGenerationJobs, type JobAttempt } from './generation-jobs.ts';

const config = loadWorkerConfig();
const logger = createLogger(config.logLevel);

const [analyzerPrompt, pageWriterPrompt] = await Promise.all([
  loadSystemPrompt('prompt-analyzer'),
  loadSystemPrompt('page-writer'),
]);
const model = createGeminiModel(config.llm);
const database = connectDatabase(config.databaseUrl);
const boss = await startJobQueue(config.databaseUrl);
boss.on('error', (error) => logger.error({ err: error }, 'Job queue error'));

const jobs = createGenerationJobs({
  db: database.db,
  boss,
  logger,
  analyzePrompt: createPromptAnalyzer({
    model,
    config: config.llm,
    logger,
    prompt: analyzerPrompt,
  }),
  writePage: createPageWriter({ model, config: config.llm, logger, prompt: pageWriterPrompt }),
  model: config.llm.model,
  promptVersion: `${analyzerPrompt.version}+${pageWriterPrompt.version}`,
});

/** Job payloads come from the database; they are validated like any other input. */
function attemptOf(job: { data: unknown; retryCount: number }): JobAttempt {
  const { generationId } = generationJobSchema.parse(job.data);
  return { generationId, retryCount: job.retryCount };
}

const workOptions = { localConcurrency: config.concurrency };
await boss.work(QUEUES.analyze, workOptions, async ([job]) => {
  if (job !== undefined) await jobs.analyzeGeneration(attemptOf(job));
});
await boss.work(QUEUES.render, workOptions, async ([job]) => {
  if (job !== undefined) await jobs.renderGeneration(attemptOf(job));
});
logger.info({ concurrency: config.concurrency }, 'Worker started');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  await boss.stop();
  await database.close();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
