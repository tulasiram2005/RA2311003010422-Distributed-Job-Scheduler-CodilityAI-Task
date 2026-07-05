import { Router } from "express";
import { z } from "zod";
import { sql, type Kysely } from "kysely";
import type { Database } from "@scheduler/db";
import { validate } from "../middleware/validate";
import { requireAuth, requireRole } from "../middleware/auth";
import { getOwnedProject, getOwnedQueue } from "../lib/scope";

const createQueueSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  concurrencyLimit: z.number().int().min(1).max(1000).default(5),
  defaultPriority: z.number().int().min(0).max(100).default(0),
  retryPolicy: z
    .object({
      strategy: z.enum(["FIXED", "LINEAR", "EXPONENTIAL"]).default("EXPONENTIAL"),
      baseDelayMs: z.number().int().min(0).default(1000),
      maxDelayMs: z.number().int().min(0).default(300000),
      maxAttempts: z.number().int().min(0).max(50).default(5),
      useJitter: z.boolean().default(true),
    })
    .default({}),
});

const updateQueueSchema = z.object({
  description: z.string().max(500).optional(),
  concurrencyLimit: z.number().int().min(1).max(1000).optional(),
  defaultPriority: z.number().int().min(0).max(100).optional(),
});

export function queuesRouter(db: Kysely<Database>): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res, next) => {
    try {
      const projectId = req.query.projectId as string | undefined;
      let query = db
        .selectFrom("queues")
        .innerJoin("projects", "projects.id", "queues.project_id")
        .selectAll("queues")
        .where("projects.organization_id", "=", req.auth!.orgId);

      if (projectId) query = query.where("queues.project_id", "=", projectId);

      const queues = await query.orderBy("queues.created_at", "desc").execute();
      res.json({ data: queues });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", requireRole("OWNER", "ADMIN"), validate(createQueueSchema), async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createQueueSchema>;
      await getOwnedProject(db, body.projectId, req.auth!.orgId);

      const queue = await db.transaction().execute(async (trx) => {
        const q = await trx
          .insertInto("queues")
          .values({
            project_id: body.projectId,
            name: body.name,
            description: body.description ?? null,
            concurrency_limit: body.concurrencyLimit,
            default_priority: body.defaultPriority,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("retry_policies")
          .values({
            queue_id: q.id,
            strategy: body.retryPolicy.strategy,
            base_delay_ms: body.retryPolicy.baseDelayMs,
            max_delay_ms: body.retryPolicy.maxDelayMs,
            max_attempts: body.retryPolicy.maxAttempts,
            use_jitter: body.retryPolicy.useJitter,
          })
          .execute();

        return q;
      });

      res.status(201).json(queue);
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const queue = await getOwnedQueue(db, req.params.id, req.auth!.orgId);
      const retryPolicy = await db
        .selectFrom("retry_policies")
        .selectAll()
        .where("queue_id", "=", queue.id)
        .executeTakeFirst();
      res.json({ ...queue, retryPolicy });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", requireRole("OWNER", "ADMIN"), validate(updateQueueSchema), async (req, res, next) => {
    try {
      await getOwnedQueue(db, req.params.id, req.auth!.orgId);
      const updates = req.body as z.infer<typeof updateQueueSchema>;

      const updated = await db
        .updateTable("queues")
        .set({
          ...(updates.description !== undefined && { description: updates.description }),
          ...(updates.concurrencyLimit !== undefined && { concurrency_limit: updates.concurrencyLimit }),
          ...(updates.defaultPriority !== undefined && { default_priority: updates.defaultPriority }),
          updated_at: new Date(),
        })
        .where("id", "=", req.params.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/pause", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
    try {
      await getOwnedQueue(db, req.params.id, req.auth!.orgId);
      const updated = await db
        .updateTable("queues")
        .set({ is_paused: true, updated_at: new Date() })
        .where("id", "=", req.params.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/resume", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
    try {
      await getOwnedQueue(db, req.params.id, req.auth!.orgId);
      const updated = await db
        .updateTable("queues")
        .set({ is_paused: false, updated_at: new Date() })
        .where("id", "=", req.params.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // Aggregate stats for the dashboard's queue cards: counts per status plus
  // a rough throughput figure. Deliberately one raw query rather than N+1
  // round trips per queue.
  router.get("/:id/stats", async (req, res, next) => {
    try {
      const queue = await getOwnedQueue(db, req.params.id, req.auth!.orgId);

      const counts = await db
        .selectFrom("jobs")
        .select(["status", sql<number>`count(*)`.as("count")])
        .where("queue_id", "=", queue.id)
        .groupBy("status")
        .execute();

      const throughput = await sql<{ completed_last_hour: string }>`
        SELECT count(*) as completed_last_hour FROM job_executions je
        JOIN jobs j ON j.id = je.job_id
        WHERE j.queue_id = ${queue.id}
          AND je.status = 'COMPLETED'
          AND je.finished_at > now() - interval '1 hour'
      `.execute(db);

      const avgDuration = await sql<{ avg_ms: string | null }>`
        SELECT avg(duration_ms) as avg_ms FROM job_executions je
        JOIN jobs j ON j.id = je.job_id
        WHERE j.queue_id = ${queue.id} AND je.status = 'COMPLETED'
      `.execute(db);

      res.json({
        queueId: queue.id,
        counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.count)])),
        completedLastHour: Number(throughput.rows[0]?.completed_last_hour ?? 0),
        avgDurationMs: avgDuration.rows[0]?.avg_ms ? Math.round(Number(avgDuration.rows[0].avg_ms)) : null,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
