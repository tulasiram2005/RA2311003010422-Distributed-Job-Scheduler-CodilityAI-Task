import type { Kysely } from "kysely";
import type { Database } from "@scheduler/db";
import { reclaimAbandonedJobs } from "@scheduler/db";
import { computeNextRun } from "@scheduler/shared";
import { logger } from "./logger";

/**
 * Promotes SCHEDULED (delayed/scheduled) and RETRYING jobs whose wait time
 * has elapsed into QUEUED, so the claim query picks them up on the next
 * poll. Both cases are structurally the same operation — "this job has been
 * sitting in a waiting state and its due time has passed" — so one query
 * handles both instead of two near-identical ones.
 */
async function promoteDueJobs(db: Kysely<Database>): Promise<number> {
  const now = new Date();
  const result = await db
    .updateTable("jobs")
    .set({ status: "QUEUED", updated_at: now })
    .where("status", "in", ["SCHEDULED", "RETRYING"])
    .where(({ eb, or, and }) =>
      or([
        and([eb("run_after", "is not", null), eb("run_after", "<=", now)]),
        and([eb("scheduled_at", "is not", null), eb("scheduled_at", "<=", now)]),
      ])
    )
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0);
}

/** Fires any recurring schedule whose next_run_at has passed: spawns a Job row and advances next_run_at. */
async function fireDueSchedules(db: Kysely<Database>): Promise<number> {
  const due = await db
    .selectFrom("schedules")
    .selectAll()
    .where("is_active", "=", true)
    .where("next_run_at", "<=", new Date())
    .execute();

  for (const schedule of due) {
    await db.transaction().execute(async (trx) => {
      const queue = await trx
        .selectFrom("queues")
        .select(["default_priority"])
        .where("id", "=", schedule.queue_id)
        .executeTakeFirst();

      await trx
        .insertInto("jobs")
        .values({
          queue_id: schedule.queue_id,
          schedule_id: schedule.id,
          job_type: "scheduled_run", // handlers can branch on payload to know which schedule fired
          payload: schedule.payload,
          priority: queue?.default_priority ?? 0,
          status: "QUEUED",
        })
        .execute();

      await trx
        .updateTable("schedules")
        .set({ last_run_at: new Date(), next_run_at: computeNextRun(schedule.cron_expression) })
        .where("id", "=", schedule.id)
        .execute();
    });
  }

  return due.length;
}

export async function runSweep(db: Kysely<Database>): Promise<void> {
  const reclaimed = await reclaimAbandonedJobs(db);
  const promoted = await promoteDueJobs(db);
  const fired = await fireDueSchedules(db);

  if (reclaimed > 0) logger.warn({ reclaimed }, "reclaimed jobs abandoned by dead workers");
  if (promoted > 0) logger.debug({ promoted }, "promoted due jobs to QUEUED");
  if (fired > 0) logger.info({ fired }, "fired due cron schedules");
}
