import { sql, type Kysely } from "kysely";
import type { Database } from "@scheduler/db";

/**
 * A queue's concurrency_limit caps how many jobs may run AT ONCE across the
 * whole fleet, not per worker. worker_leases tracks how many slots each
 * worker currently holds against each queue; summing that column tells us
 * how much headroom is left before the next claim.
 */
export async function availableSlots(db: Kysely<Database>, queueId: string, concurrencyLimit: number): Promise<number> {
  const result = await sql<{ used: string | null }>`
    SELECT sum(slots) as used FROM worker_leases WHERE queue_id = ${queueId}
  `.execute(db);
  const used = Number(result.rows[0]?.used ?? 0);
  return Math.max(0, concurrencyLimit - used);
}

export async function acquireSlots(db: Kysely<Database>, workerId: string, queueId: string, count: number): Promise<void> {
  if (count <= 0) return;
  await sql`
    INSERT INTO worker_leases (worker_id, queue_id, slots)
    VALUES (${workerId}, ${queueId}, ${count})
    ON CONFLICT (worker_id, queue_id)
    DO UPDATE SET slots = worker_leases.slots + ${count}, updated_at = now()
  `.execute(db);
}

export async function releaseSlot(db: Kysely<Database>, workerId: string, queueId: string): Promise<void> {
  await sql`
    UPDATE worker_leases SET slots = greatest(0, slots - 1), updated_at = now()
    WHERE worker_id = ${workerId} AND queue_id = ${queueId}
  `.execute(db);
}

/** Called on startup/shutdown so a worker never leaves stale slots behind after a crash or a clean exit. */
export async function releaseAllSlots(db: Kysely<Database>, workerId: string): Promise<void> {
  await db.deleteFrom("worker_leases").where("worker_id", "=", workerId).execute();
}
