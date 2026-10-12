import { join } from 'node:path';
import { parseEnv } from '@peafowl/shared';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { z } from 'zod';
import { connectDatabase } from './client.ts';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

export async function runMigrations(databaseUrl: string): Promise<void> {
  const connection = connectDatabase(databaseUrl);
  try {
    await migrate(connection.db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await connection.close();
  }
}

// Run directly: npm run db:migrate
if (import.meta.filename === process.argv[1]) {
  const { DATABASE_URL } = parseEnv(z.object({ DATABASE_URL: z.url() }), process.env);
  await runMigrations(DATABASE_URL);
  console.log('Migrations applied');
}
