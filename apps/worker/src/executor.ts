import type { Kysely } from "kysely";
import type { Database, ClaimedJob } from "@scheduler/db";
import { computeRetryDelayMs, shouldMoveToDeadLetter, type RetryStrategy } from "@scheduler/shared";
import { getHandler } from "./handlers";
import { logger } from "./logger";

interface RetryPolicyRow {
  strategy: RetryStrategy;
  base_delay_ms: number;
  max_delay_ms: number;
  max_attempts: number;
  use_jitter: boolean;
}

const DEFAULT_POLICY: RetryPolicyRow = {
  strategy: "EXPONENTIAL",
  base_delay_ms: 1000,
  max_delay_ms: 300000,
  max_attempts: 5,
  use_jitter: true,
};

/**
 * Runs one claimed job end to end: flips it to RUNNING, invokes the
 * registered handler, and — depending on outcome — either marks it
 * COMPLETED, schedules a backoff retry, or moves it to the dead letter
 * queue. Every attempt gets its own job_executions row and its own log
 * lines, so the dashboard's job-detail view has a real history to show
 * regardless of how this attempt goes.
 */
export async function executeClaimedJob(db: Kysely<Database>, job: ClaimedJob, workerId: string): Promise<void> {
  const attemptNumber = job.attempt_count + 1;
  const logLines: { level: string; message: string }[] = [];
  const log = (message: string) => {
    logLines.push({ level: "info", message });
    logger.debug({ jobId: job.id, attemptNumber }, message);
  };

  await db
    .updateTable("jobs")
    .set({ status: "RUNNING", updated_at: new Date() })
    .where("id", "=", job.id)
    .where("status", "=", "CLAIMED") // only advance if still ours — defends against a lease that expired mid-flight
    .execute();

  const startedAt = new Date();
  let succeeded = true;
  let errorMessage: string | undefined;
  let errorStack: string | undefined;

  try {
    const handler = getHandler(job.job_type);
    await handler({ jobId: job.id, attempt: attemptNumber, payload: job.payload, log });
  } catch (err) {
    succeeded = false;
    errorMessage = err instanceof Error ? err.message : String(err);
    errorStack = err instanceof Error ? err.stack : undefined;
    log(`attempt ${attemptNumber} failed: ${errorMessage}`);
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  const execution = await db
    .insertInto("job_executions")
    .values({
      job_id: job.id,
      attempt_number: attemptNumber,
      worker_id: workerId,
      started_at: startedAt,
      finished_at: finishedAt,
      status: succeeded ? "COMPLETED" : "FAILED",
      error_message: errorMessage ?? null,
      error_stack: errorStack ?? null,
      duration_ms: durationMs,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  if (logLines.length > 0) {
    await db
      .insertInto("job_logs")
      .values(logLines.map((l) => ({ execution_id: execution.id, level: l.level, message: l.message })))
      .execute();
  }

  if (succeeded) {
    await db
      .updateTable("jobs")
      .set({
        status: "COMPLETED",
        attempt_count: attemptNumber,
        claimed_by_worker_id: null,
        lease_expires_at: null,
        updated_at: new Date(),
      })
      .where("id", "=", job.id)
      .execute();
    return;
  }

  const policy = await loadRetryPolicy(db, job.queue_id);
  const maxAttempts = job.max_attempts ?? policy.max_attempts;

  if (shouldMoveToDeadLetter(attemptNumber, maxAttempts)) {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("jobs")
        .set({
          status: "DEAD",
          attempt_count: attemptNumber,
          claimed_by_worker_id: null,
          lease_expires_at: null,
          updated_at: new Date(),
        })
        .where("id", "=", job.id)
        .execute();

      await trx
        .insertInto("dead_letter_entries")
        .values({
          job_id: job.id,
          original_queue_id: job.queue_id,
          final_error: errorMessage ?? "unknown error",
        })
        .execute();
    });
    logger.warn({ jobId: job.id, attemptNumber }, "job moved to dead letter queue");
    return;
  }

  const delayMs = computeRetryDelayMs(attemptNumber, {
    strategy: policy.strategy,
    baseDelayMs: policy.base_delay_ms,
    maxDelayMs: policy.max_delay_ms,
    useJitter: policy.use_jitter,
  });

  await db
    .updateTable("jobs")
    .set({
      status: "RETRYING",
      attempt_count: attemptNumber,
      claimed_by_worker_id: null,
      lease_expires_at: null,
      run_after: new Date(Date.now() + delayMs),
      updated_at: new Date(),
    })
    .where("id", "=", job.id)
    .execute();

  logger.info({ jobId: job.id, attemptNumber, delayMs }, "job scheduled for retry");
}

async function loadRetryPolicy(db: Kysely<Database>, queueId: string): Promise<RetryPolicyRow> {
  const row = await db
    .selectFrom("retry_policies")
    .select(["strategy", "base_delay_ms", "max_delay_ms", "max_attempts", "use_jitter"])
    .where("queue_id", "=", queueId)
    .executeTakeFirst();
  return row ?? DEFAULT_POLICY;
}
