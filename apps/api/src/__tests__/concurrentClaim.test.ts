import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb, claimJobs, type Database } from "@scheduler/db";
import type { Kysely } from "kysely";
import { randomUUID } from "crypto";

// This is deliberately NOT a mocked test. It hits the real local Postgres
// instance and spins up genuinely concurrent transactions, because the
// entire point of `FOR UPDATE SKIP LOCKED` is a real locking behavior that a
// mock can't reproduce — a fake DB client would happily let two "workers"
// claim the same row and the test would lie to us.
describe("claimJobs — concurrent workers never claim the same job", () => {
  let db: Kysely<Database>;
  let orgId: string;
  let projectId: string;
  let queueId: string;

  beforeAll(async () => {
    db = createDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    const org = await db
      .insertInto("organizations")
      .values({ name: `test-org-${randomUUID()}`, slug: `test-${randomUUID()}` })
      .returningAll()
      .executeTakeFirstOrThrow();
    orgId = org.id;

    const project = await db
      .insertInto("projects")
      .values({ organization_id: orgId, name: "test-project", api_key_hash: `test-${randomUUID()}` })
      .returningAll()
      .executeTakeFirstOrThrow();
    projectId = project.id;

    const queue = await db
      .insertInto("queues")
      .values({ project_id: projectId, name: `test-queue-${randomUUID()}` })
      .returningAll()
      .executeTakeFirstOrThrow();
    queueId = queue.id;
  });

  async function registerWorker(): Promise<string> {
    const worker = await db
      .insertInto("workers")
      .values({ hostname: "test-host", pid: Math.floor(Math.random() * 100000) })
      .returningAll()
      .executeTakeFirstOrThrow();
    return worker.id;
  }

  it("never lets two concurrent claimers walk away with the same job", async () => {
    const JOB_COUNT = 40;
    const WORKER_COUNT = 8;
    const CLAIM_BATCH_SIZE = 3;

    await db
      .insertInto("jobs")
      .values(
        Array.from({ length: JOB_COUNT }, (_, i) => ({
          queue_id: queueId,
          job_type: "test_job",
          payload: JSON.stringify({ i }),
          status: "QUEUED" as const,
        }))
      )
      .execute();

    const workerIds = await Promise.all(Array.from({ length: WORKER_COUNT }, () => registerWorker()));

    // Fire all workers' claim attempts at once, repeatedly, until the queue
    // is drained — this is the adversarial case: many workers hammering the
    // same queue at the same moment, which is exactly when a race condition
    // would show itself.
    const claimedJobIds: string[] = [];
    let remaining = JOB_COUNT;
    let roundsWithoutProgress = 0;

    while (remaining > 0 && roundsWithoutProgress < 5) {
      const results = await Promise.all(
        workerIds.map((workerId) => claimJobs(db, workerId, queueId, CLAIM_BATCH_SIZE))
      );

      const roundClaimed = results.flat().map((j) => j.id);
      if (roundClaimed.length === 0) {
        roundsWithoutProgress++;
      } else {
        roundsWithoutProgress = 0;
      }

      claimedJobIds.push(...roundClaimed);
      remaining -= roundClaimed.length;
    }

    // The core assertion: every claimed job id is unique. If SKIP LOCKED
    // (or the transaction boundary around it) were broken, this is where
    // it would show up as a duplicate.
    const uniqueIds = new Set(claimedJobIds);
    expect(uniqueIds.size).toBe(claimedJobIds.length);

    // And every job that existed got claimed by exactly one of the workers.
    expect(claimedJobIds.length).toBe(JOB_COUNT);

    const stillQueued = await db
      .selectFrom("jobs")
      .select(({ fn }) => [fn.count<number>("id").as("count")])
      .where("queue_id", "=", queueId)
      .where("status", "=", "QUEUED")
      .executeTakeFirstOrThrow();
    expect(Number(stillQueued.count)).toBe(0);

    const claimedRows = await db
      .selectFrom("jobs")
      .select(["status", "claimed_by_worker_id"])
      .where("queue_id", "=", queueId)
      .execute();
    for (const row of claimedRows) {
      expect(row.status).toBe("CLAIMED");
      expect(row.claimed_by_worker_id).not.toBeNull();
    }
  });

  it("respects the requested claim limit per call", async () => {
    await db
      .insertInto("jobs")
      .values(
        Array.from({ length: 10 }, () => ({ queue_id: queueId, job_type: "test_job", payload: "{}", status: "QUEUED" as const }))
      )
      .execute();

    const claimed = await claimJobs(db, await registerWorker(), queueId, 4);
    expect(claimed.length).toBe(4);
  });

  it("orders claims by priority (highest first)", async () => {
    await db
      .insertInto("jobs")
      .values([
        { queue_id: queueId, job_type: "low", payload: "{}", status: "QUEUED", priority: 1 },
        { queue_id: queueId, job_type: "high", payload: "{}", status: "QUEUED", priority: 10 },
        { queue_id: queueId, job_type: "mid", payload: "{}", status: "QUEUED", priority: 5 },
      ])
      .execute();

    const claimed = await claimJobs(db, await registerWorker(), queueId, 1);
    expect(claimed[0].job_type).toBe("high");
  });

  it("does not claim jobs whose run_after is in the future", async () => {
    await db
      .insertInto("jobs")
      .values({
        queue_id: queueId,
        job_type: "delayed",
        payload: "{}",
        status: "QUEUED",
        run_after: new Date(Date.now() + 60_000),
      })
      .execute();

    const claimed = await claimJobs(db, await registerWorker(), queueId, 5);
    expect(claimed.length).toBe(0);
  });
});
