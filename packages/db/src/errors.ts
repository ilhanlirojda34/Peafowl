import pg from 'pg';

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

/** Finds the PostgreSQL error behind a failed query. Drizzle wraps driver errors, so causes are followed. */
export function postgresError(error: unknown): pg.DatabaseError | undefined {
  let current = error;
  while (current instanceof Error) {
    if (current instanceof pg.DatabaseError) return current;
    current = current.cause;
  }
  return undefined;
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = postgresError(error);
  return cause?.code === PG_UNIQUE_VIOLATION && cause.constraint === constraint;
}
