import { loadLlmConfig, type LlmConfig } from '@peafowl/generator';
import { logLevelSchema, parseEnv, type LogLevel } from '@peafowl/shared';
import { z } from 'zod';

const workerEnvSchema = z.object({
  DATABASE_URL: z.url(),
  LOG_LEVEL: logLevelSchema,
  /** Jobs processed in parallel. Keep low on free LLM tiers to stay under rate limits. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(1),
});

export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly logLevel: LogLevel;
  readonly concurrency: number;
  readonly llm: LlmConfig;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const values = parseEnv(workerEnvSchema, env);
  return {
    databaseUrl: values.DATABASE_URL,
    logLevel: values.LOG_LEVEL,
    concurrency: values.WORKER_CONCURRENCY,
    llm: loadLlmConfig(env),
  };
}
