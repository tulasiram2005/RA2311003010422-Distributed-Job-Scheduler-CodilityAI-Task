import { Router } from "express";
import { z } from "zod";
import type { Kysely } from "kysely";
import type { Database } from "@scheduler/db";
import { validate } from "../middleware/validate";
import { requireAuth } from "../middleware/auth";
import { getOwnedQueue, getOwnedJob } from "../lib/scope";
import { Errors } from "../lib/errors";
import { isValidTransition } from "@scheduler/shared";
import type { Server as SocketServer } from "socket.io";

const createJobSchema = z.object({
  queueId: z.string().uuid(),
  jobType: z.string().min(1).max(120),
  payload: z.record(z.unknown()).default({}),
  priority: z.number().int().min(0).max(100).optional(),
  idempotencyKey: z.string().max(200).optional(),
  maxAttempts: z.number().int().min(1).max(50).optional(),
  // exactly one of these determines the job "kind"; all are optional and
  // absence of both means "immediate"
  runAfter: z.string().datetime().optional(), // delayed
  scheduledAt: z.string().datetime().optional(), // scheduled
});

const batchCreateSchema = z.object({
  queueId: z.string().uuid(),
  label: z.string().max(120).optional(),
  jobs: z
    .array(
      z.object({
        jobType: z.string().min(1).max(120),
        payload: z.record(z.unknown()).default({}),
        priority: z.number().int().min(0).max(100).optional(),
      })
    )
    .min(1)
    .max(1000),
});

const listJobsQuerySchema = z.object({
  queueId: z.string().uuid().optional(),
  status: z
    .enum(["SCHEDULED", "QUEUED", "CLAIMED", "RUNNING", "COMPLETED", "FAILED", "RETRYING", "DEAD", "CANCELLED"])
    .optional(),
  jobType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export function jobsRouter(db: Kysely<Database>, io: SocketServer): Router {
  const router = Router();
  router.use(requireAuth);

  router.post("/", validate(createJobSchema), async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createJobSchema>;
      const queue = await getOwnedQueue(db, body.queueId, req.auth!.orgId);

      if (body.runAfter && body.scheduledAt) {
        throw Errors.badRequest("A job can't have both runAfter and scheduledAt — pick one");
      }

      // idempotency: if the caller already submitted a job with this key on
      // this queue, hand back the existing job instead of creating a twin
      if (body.idempotencyKey) {
        const existing = await db
          .selectFrom("jobs")
          .selectAll()
          .where("queue_id", "=", queue.id)
          .where("idempotency_key", "=", body.idempotencyKey)
          .executeTakeFirst();
        if (existing) return res.status(200).json({ ...existing, deduplicated: true });
      }

      const isFuture = Boolean(body.runAfter || body.scheduledAt);

      const job = await db
        .insertInto("jobs")
        .values({
          queue_id: queue.id,
          job_type: body.jobType,
          payload: JSON.stringify(body.payload),
          priority: body.priority ?? queue.default_priority,
          idempotency_key: body.idempotencyKey ?? null,
          max_attempts: body.maxAttempts ?? null,
          run_after: body.runAfter ? new Date(body.runAfter) : null,
          scheduled_at: body.scheduledAt ? new Date(body.scheduledAt) : null,
          status: isFuture ? "SCHEDULED" : "QUEUED",
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      io.to(`queue:${queue.id}`).emit("job:created", { jobId: job.id, queueId: queue.id, status: job.status });

      res.status(201).json(job);
    } catch (err) {
      next(err);
    }
  });

  router.post("/batch", validate(batchCreateSchema), async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof batchCreateSchema>;
      const queue = await getOwnedQueue(db, body.queueId, req.auth!.orgId);

      const result = await db.transaction().execute(async (trx) => {
        const batch = await trx
          .insertInto("batches")
          .values({ project_id: queue.project_id, label: body.label ?? null, job_count: body.jobs.length })
          .returningAll()
          .executeTakeFirstOrThrow();

        const jobs = await trx
          .insertInto("jobs")
          .values(
            body.jobs.map((j) => ({
              queue_id: queue.id,
              batch_id: batch.id,
              job_type: j.jobType,
              payload: JSON.stringify(j.payload),
              priority: j.priority ?? queue.default_priority,
              status: "QUEUED" as const,
            }))
          )
          .returningAll()
          .execute();

        return { batch, jobs };
      });

      io.to(`queue:${queue.id}`).emit("batch:created", { batchId: result.batch.id, count: result.jobs.length });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get("/", validate(listJobsQuerySchema, "query"), async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof listJobsQuerySchema>;

      let query = db
        .selectFrom("jobs")
        .innerJoin("queues", "queues.id", "jobs.queue_id")
        .innerJoin("projects", "projects.id", "queues.project_id")
        .selectAll("jobs")
        .where("projects.organization_id", "=", req.auth!.orgId);

      if (q.queueId) query = query.where("jobs.queue_id", "=", q.queueId);
      if (q.status) query = query.where("jobs.status", "=", q.status);
      if (q.jobType) query = query.where("jobs.job_type", "=", q.jobType);
      if (q.from) query = query.where("jobs.created_at", ">=", new Date(q.from));
      if (q.to) query = query.where("jobs.created_at", "<=", new Date(q.to));
      // cursor pagination on (created_at, id) — stable even while new rows
      // are being inserted concurrently, unlike offset pagination
      if (q.cursor) {
        const [createdAt, id] = Buffer.from(q.cursor, "base64").toString("utf-8").split("|");
        query = query.where(({ eb, or, and }) =>
          or([eb("jobs.created_at", "<", new Date(createdAt)), and([eb("jobs.created_at", "=", new Date(createdAt)), eb("jobs.id", "<", id)])])
        );
      }

      const rows = await query
        .orderBy("jobs.created_at", "desc")
        .orderBy("jobs.id", "desc")
        .limit(q.limit + 1)
        .execute();

      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? Buffer.from(`${new Date(last.created_at).toISOString()}|${last.id}`).toString("base64") : null;

      res.json({ data: page, nextCursor });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const job = await getOwnedJob(db, req.params.id, req.auth!.orgId);
      const executions = await db
        .selectFrom("job_executions")
        .selectAll()
        .where("job_id", "=", job.id)
        .orderBy("attempt_number", "asc")
        .execute();

      const executionIds = executions.map((e) => e.id);
      const logs = executionIds.length
        ? await db.selectFrom("job_logs").selectAll().where("execution_id", "in", executionIds).orderBy("created_at", "asc").execute()
        : [];

      res.json({ ...job, executions, logs });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/retry", async (req, res, next) => {
    try {
      const job = await getOwnedJob(db, req.params.id, req.auth!.orgId);

      if (!isValidTransition(job.status, "QUEUED") && job.status !== "DEAD") {
        throw Errors.badRequest(`Job in status ${job.status} cannot be manually retried`);
      }

      const updated = await db.transaction().execute(async (trx) => {
        const j = await trx
          .updateTable("jobs")
          .set({ status: "QUEUED", claimed_by_worker_id: null, claimed_at: null, lease_expires_at: null, updated_at: new Date() })
          .where("id", "=", job.id)
          .returningAll()
          .executeTakeFirstOrThrow();

        if (job.status === "DEAD") {
          await trx.updateTable("dead_letter_entries").set({ requeued: true }).where("job_id", "=", job.id).execute();
        }

        return j;
      });

      io.to(`queue:${job.queue_id}`).emit("job:retried", { jobId: job.id, queueId: job.queue_id });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/cancel", async (req, res, next) => {
    try {
      const job = await getOwnedJob(db, req.params.id, req.auth!.orgId);

      if (!isValidTransition(job.status, "CANCELLED")) {
        throw Errors.badRequest(`Job in status ${job.status} cannot be cancelled`);
      }

      const updated = await db
        .updateTable("jobs")
        .set({ status: "CANCELLED", updated_at: new Date() })
        .where("id", "=", job.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
