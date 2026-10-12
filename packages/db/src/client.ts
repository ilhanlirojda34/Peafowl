import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Where queries run: the pool, or an open transaction. */
export type DatabaseExecutor = Database | Transaction;

export interface DatabaseConnection {
  readonly db: Database;
  readonly close: () => Promise<void>;
}

export function connectDatabase(databaseUrl: string): DatabaseConnection {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
