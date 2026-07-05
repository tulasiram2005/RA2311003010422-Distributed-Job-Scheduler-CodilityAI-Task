import { sql, type Kysely } from "kysely";
import type { Database } from "./types";

export interface ClaimedJob {
  id: string;
  queue_id: string;
  job_type: string;
  payload: unknown;
  priority: number;
  attempt_count: number;
  max_attempts: number | null;
}

const DEFAULT_LEASE_MS = 5 * 60 * 1000; // 5 minutes — if a worker dies mid-job, the sweep reclaims after this

/**
 * The atomic claim. This is the mechanism the whole "no duplicate execution"
 * guarantee rests on, so it gets its own file and its own heavy commenting.
 *
 * `FOR UPDATE SKIP LOCKED` inside a transaction does two things at once:
 *   1. Row-locks whatever it selects, so no other transaction can select
 *      the same rows until this one commits.
 *   2. SKIPS rows that are already locked by a concurrent transaction,
 *      instead of blocking on them.
 *
 * That combination is exactly "many workers can poll the same queue at the
 * same time and none of them will ever grab the same job." Without SKIP
 * LOCKED, worker B would just queue up behind worker A's lock and then
 * still get the same row once A commits — SKIP LOCKED is what makes this a
 * genuine work-stealing claim instead of a serialized bottleneck.
 *
 * The UPDATE happens in the SAME transaction as the SELECT, so the
 * lock is only released once the row's status has already flipped to
 * CLAIMED — there's no window where another worker could see it as QUEUED.
 */
export async function claimJobs(
  db: Kysely<Database>,
  workerId: string,
  queueId: string,
  limit: number,
  leaseMs: number = DEFAULT_LEASE_MS
): Promise<ClaimedJob[]> {
  return db.transaction().execute(async (trx) => {
    const candidates = await sql<{ id: string }>`
      SELECT id FROM jobs
      WHERE queue_id = ${queueId}
        AND status = 'QUEUED'
        AND (run_after IS NULL OR run_after <= now())
        AND (scheduled_at IS NULL OR scheduled_at <= now())
      ORDER BY priority DESC, created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `.execute(trx);

    const ids = candidates.rows.map((r) => r.id);
    if (ids.length === 0) return [];

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);

    await trx
      .updateTable("jobs")
      .set({
        status: "CLAIMED",
        claimed_by_worker_id: workerId,
        claimed_at: now,
        lease_expires_at: leaseExpiresAt,
        updated_at: now,
      })
      .where("id", "in", ids)
      .execute();

    const claimed = await trx
      .selectFrom("jobs")
      .select(["id", "queue_id", "job_type", "payload", "priority", "attempt_count", "max_attempts"])
      .where("id", "in", ids)
      .execute();

    return claimed as ClaimedJob[];
  });
}

/**
 * Reclaims jobs whose lease expired while still CLAIMED/RUNNING — i.e. the
 * worker holding them died (or its process was killed) without releasing
 * them. Runs on a timer from the worker's sweep loop, not from a request.
 */
export async function reclaimAbandonedJobs(db: Kysely<Database>): Promise<number> {
  const result = await db
    .updateTable("jobs")
    .set({
      status: "QUEUED",
      claimed_by_worker_id: null,
      claimed_at: null,
      lease_expires_at: null,
      updated_at: new Date(),
    })
    .where("status", "in", ["CLAIMED", "RUNNING"])
    .where("lease_expires_at", "is not", null)
    .where("lease_expires_at", "<", new Date())
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0);
}
