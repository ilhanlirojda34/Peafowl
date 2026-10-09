import { z } from 'zod';

const envSchema = z.object({
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  EVAL_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
});

export interface Config {
  readonly googleApiKey: string;
  readonly model: string;
  readonly llmTimeoutMs: number;
  readonly llmMaxRetries: number;
  readonly logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  readonly evalConcurrency: number;
}

export class ConfigError extends Error {}

/** Validates the environment once at startup. Error messages name variables, never values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);
  }

  const values = parsed.data;
  return {
    googleApiKey: values.GOOGLE_GENERATIVE_AI_API_KEY,
    model: values.GEMINI_MODEL,
    llmTimeoutMs: values.LLM_TIMEOUT_MS,
    llmMaxRetries: values.LLM_MAX_RETRIES,
    logLevel: values.LOG_LEVEL,
    evalConcurrency: values.EVAL_CONCURRENCY,
  };
}
