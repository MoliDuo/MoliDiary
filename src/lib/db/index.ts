import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as schema from './schema';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

export type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

// Route handlers, server actions and instrumentation can end up in separate
// module graphs, and dev hot reloads re-evaluate this file. Keeping the pool
// on globalThis gives them all one set of connections.
const globalForPool = globalThis as typeof globalThis & {
  __diaryPool?: Pool;
};

function createPool() {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
    statement_timeout:
      Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS) || 30_000,
  });
  // An idle client dropped by the server would otherwise crash the process.
  pool.on('error', (error) => {
    console.error('Database pool error:', error);
  });
  return pool;
}

export const pool = (globalForPool.__diaryPool ??= createPool());
export const db = drizzle(pool, { schema });
