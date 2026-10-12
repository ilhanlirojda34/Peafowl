import { parseEnv } from '@peafowl/shared';
import { z } from 'zod';

const llmEnvSchema = z.object({
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  LLM_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
});

export interface LlmConfig {
  readonly googleApiKey: string;
  readonly model: string;
  readonly llmTimeoutMs: number;
  /** Max silence before the first output and between output chunks. */
  readonly llmIdleTimeoutMs: number;
  readonly llmMaxRetries: number;
}

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const values = parseEnv(llmEnvSchema, env);
  return {
    googleApiKey: values.GOOGLE_GENERATIVE_AI_API_KEY,
    model: values.GEMINI_MODEL,
    llmTimeoutMs: values.LLM_TIMEOUT_MS,
    llmIdleTimeoutMs: values.LLM_IDLE_TIMEOUT_MS,
    llmMaxRetries: values.LLM_MAX_RETRIES,
  };
}
