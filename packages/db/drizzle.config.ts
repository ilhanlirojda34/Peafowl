import { defineConfig } from 'drizzle-kit';

// Generating migrations only needs the schema; applying them is done by src/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
