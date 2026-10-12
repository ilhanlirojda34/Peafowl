import { sql } from 'drizzle-orm';
import type { Database } from './client.ts';

/**
 * Integration tests run against their own database, never the development one, because they
 * empty its tables. Fails loudly instead of skipping when it is not configured.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error('Set TEST_DATABASE_URL to a dedicated test database to run integration tests');
  }
  return url;
}

/** Empties every application table. */
export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(
    sql`TRUNCATE users, sessions, accounts, verifications, workspaces, workspace_members, projects, generations, site_versions CASCADE`,
  );
}
