import { defineConfig } from 'drizzle-kit';

// Only `generate` and `check` use this file; migrations run through
// scripts/migrate.ts, so no database credentials are needed here.
export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
});
