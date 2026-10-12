import { z } from 'zod';

export class ConfigError extends Error {}

export const logLevelSchema = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
  .default('info');

export type LogLevel = z.infer<typeof logLevelSchema>;

/** Validates environment variables once at startup. Error messages name variables, never values. */
export function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  env: NodeJS.ProcessEnv,
): z.infer<Schema> {
  const parsed = schema.safeParse(env);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new ConfigError(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);
}
