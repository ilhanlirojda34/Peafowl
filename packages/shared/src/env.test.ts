import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { ConfigError, parseEnv } from './env.ts';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  SECRET: z.string().min(1),
});

describe('parseEnv', () => {
  it('returns parsed values with defaults and coercion', () => {
    assert.deepEqual(parseEnv(schema, { SECRET: 'x', PORT: '8080' }), { SECRET: 'x', PORT: 8080 });
    assert.equal(parseEnv(schema, { SECRET: 'x' }).PORT, 3000);
  });

  it('names invalid variables without echoing their values', () => {
    assert.throws(
      () => parseEnv(schema, { PORT: 'not-a-port-secret-value' }),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.message.includes('PORT') &&
        error.message.includes('SECRET') &&
        !error.message.includes('not-a-port-secret-value'),
    );
  });
});
