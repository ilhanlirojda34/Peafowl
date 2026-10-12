import { logLevelSchema, parseEnv, type LogLevel } from '@peafowl/shared';
import { z } from 'zod';
import {
  generationQuotaRulesSchema,
  type GenerationQuotaRules,
} from './modules/generations/quota.ts';

/**
 * Free plan default until the quota policy is decided: two sites in a lifetime, no edits yet
 * (the edit flow does not exist). Override with FREE_PLAN_GENERATION_QUOTAS.
 */
const DEFAULT_FREE_PLAN_QUOTAS: GenerationQuotaRules = [
  { kinds: ['create'], limit: 2, windowDays: null },
  { kinds: ['edit'], limit: 0, windowDays: null },
];

const jsonSchema = z.string().transform((value, context) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    context.addIssue({ code: 'custom', message: 'Must be valid JSON' });
    return z.NEVER;
  }
});

const apiEnvSchema = z.object({
  DATABASE_URL: z.url(),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: logLevelSchema,
  FREE_PLAN_PROJECT_LIMIT: z.coerce.number().int().min(1).default(2),
  FREE_PLAN_GENERATION_QUOTAS: jsonSchema
    .pipe(generationQuotaRulesSchema)
    .default(DEFAULT_FREE_PLAN_QUOTAS),
  /**
   * Development-only sign-in by email header, until real authentication is built.
   * Refused in production so it can never be left on by mistake.
   */
  DEV_AUTH: z.stringbool().default(false),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export interface ApiConfig {
  readonly databaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly freePlanProjectLimit: number;
  readonly freePlanGenerationQuotas: GenerationQuotaRules;
  readonly devAuth: boolean;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const values = parseEnv(apiEnvSchema, env);
  if (values.DEV_AUTH && values.NODE_ENV === 'production') {
    throw new Error('DEV_AUTH must not be enabled in production');
  }
  return {
    databaseUrl: values.DATABASE_URL,
    host: values.API_HOST,
    port: values.API_PORT,
    logLevel: values.LOG_LEVEL,
    freePlanProjectLimit: values.FREE_PLAN_PROJECT_LIMIT,
    freePlanGenerationQuotas: values.FREE_PLAN_GENERATION_QUOTAS,
    devAuth: values.DEV_AUTH,
  };
}
