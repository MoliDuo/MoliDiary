import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (!process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
  const envFile = ['.env.local', '.env'].find((candidate) =>
    existsSync(candidate),
  );
  if (envFile) process.loadEnvFile(envFile);
}

async function main() {
  const [{ db, pool }, { migrate }] = await Promise.all([
    import('../src/lib/db/index'),
    import('drizzle-orm/node-postgres/migrator'),
  ]);
  try {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
    console.log('Database migrations applied successfully.');
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
