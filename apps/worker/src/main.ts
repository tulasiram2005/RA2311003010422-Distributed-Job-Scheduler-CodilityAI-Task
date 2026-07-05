import "dotenv/config";
import { hostname } from "os";
import { createDb, claimJobs } from "@scheduler/db";
import { executeClaimedJob } from "./executor";
import { runSweep } from "./sweep";
import { availableSlots, acquireSlots, releaseSlot, releaseAllSlots } from "./leases";
import { logger } from "./logger";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 1000);
const SWEEP_INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS ?? 3000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 5000);
const MAX_CLAIM_PER_QUEUE_PER_TICK = Number(process.env.MAX_CLAIM_PER_QUEUE_PER_TICK ?? 5);
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 15000);

const db = createDb();

let draining = false;
let workerId = "";
const inFlight = new Map<string, Promise<void>>();

async function registerWorker(): Promise<string> {
  const worker = await db
    .insertInto("workers")
    .values({ hostname: hostname(), pid: process.pid, status: "ALIVE" })
    .returningAll()
    .executeTakeFirstOrThrow();
  return worker.id;
}

async function heartbeat(): Promise<void> {
  const load = inFlight.size;
  await db
    .updateTable("workers")
    .set({ last_heartbeat_at: new Date(), current_load: load })
    .where("id", "=", workerId)
    .execute();
  await db.insertInto("worker_heartbeats").values({ worker_id: workerId, load }).execute();
}

async function pollOnce(): Promise<void> {
  if (draining) return;

  const queues = await db.selectFrom("queues").selectAll().where("is_paused", "=", false).execute();

  for (const queue of queues) {
    const slots = await availableSlots(db, queue.id, queue.concurrency_limit);
    const claimLimit = Math.min(slots, MAX_CLAIM_PER_QUEUE_PER_TICK);
    if (claimLimit <= 0) continue;

    const claimed = await claimJobs(db, workerId, queue.id, claimLimit);
    if (claimed.length === 0) continue;

    await acquireSlots(db, workerId, queue.id, claimed.length);
    logger.info({ queue: queue.name, count: claimed.length }, "claimed jobs");

    for (const job of claimed) {
      const promise = executeClaimedJob(db, job, workerId)
        .catch((err) => logger.error({ err, jobId: job.id }, "unhandled error executing job"))
        .finally(() => {
          inFlight.delete(job.id);
          void releaseSlot(db, workerId, queue.id);
        });
      inFlight.set(job.id, promise);
    }
  }
}

async function main() {
  workerId = await registerWorker();
  logger.info({ workerId, hostname: hostname(), pid: process.pid }, "worker started");

  const pollTimer = setInterval(() => void pollOnce().catch((err) => logger.error({ err }, "poll loop error")), POLL_INTERVAL_MS);
  const sweepTimer = setInterval(() => void runSweep(db).catch((err) => logger.error({ err }, "sweep loop error")), SWEEP_INTERVAL_MS);
  const heartbeatTimer = setInterval(() => void heartbeat().catch((err) => logger.error({ err }, "heartbeat error")), HEARTBEAT_INTERVAL_MS);

  await heartbeat(); // one immediate beat so the dashboard shows this worker right away

  async function shutdown(signal: string) {
    if (draining) return;
    draining = true;
    logger.info({ signal }, "draining: no longer claiming new jobs, waiting for in-flight work");

    clearInterval(pollTimer);
    clearInterval(sweepTimer);
    clearInterval(heartbeatTimer);

    await db.updateTable("workers").set({ status: "DRAINING" }).where("id", "=", workerId).execute();

    const timeout = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
    await Promise.race([Promise.allSettled(inFlight.values()), timeout]);

    if (inFlight.size > 0) {
      logger.warn({ remaining: inFlight.size }, "grace period elapsed with jobs still running — they will be reclaimed by lease expiry");
    }

    await releaseAllSlots(db, workerId);
    await db.updateTable("workers").set({ status: "DEAD" }).where("id", "=", workerId).execute();
    await db.destroy();
    logger.info("shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "worker failed to start");
  process.exit(1);
});
