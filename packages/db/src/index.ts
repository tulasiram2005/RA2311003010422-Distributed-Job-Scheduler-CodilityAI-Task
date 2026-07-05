import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./types";

export * from "./types";

let poolInstance: Pool | null = null;

// Both the API and the worker import this. They each get their own Kysely
// wrapper but share the same underlying pg Pool per-process — a worker
// polling every second has no business opening a fresh TCP connection each
// tick.
function getPool(): Pool {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX ?? 10),
    });
  }
  return poolInstance;
}

export function createDb(): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: getPool() }),
  });
}

export type { Database } from "./types";
export type * from "./types";
export { claimJobs, reclaimAbandonedJobs } from "./claim";
export type { ClaimedJob } from "./claim";
