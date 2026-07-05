import { Router } from "express";
import { z } from "zod";
import type { Kysely } from "kysely";
import type { Database } from "@scheduler/db";
import { validate } from "../middleware/validate";
import { requireAuth } from "../middleware/auth";
import { getOwnedQueue } from "../lib/scope";
import { computeNextRun, isValidCronExpression } from "@scheduler/shared";
import { Errors } from "../lib/errors";

const createScheduleSchema = z.object({
  queueId: z.string().uuid(),
  name: z.string().min(1).max(120),
  cronExpression: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
});

export function schedulesRouter(db: Kysely<Database>): Router {
  const router = Router();
  router.use(requireAuth);

  router.post("/", validate(createScheduleSchema), async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createScheduleSchema>;
      const queue = await getOwnedQueue(db, body.queueId, req.auth!.orgId);

      if (!isValidCronExpression(body.cronExpression)) {
        throw Errors.badRequest(`"${body.cronExpression}" is not a valid cron expression`);
      }

      const schedule = await db
        .insertInto("schedules")
        .values({
          queue_id: queue.id,
          name: body.name,
          cron_expression: body.cronExpression,
          payload: JSON.stringify(body.payload),
          next_run_at: computeNextRun(body.cronExpression),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      res.status(201).json(schedule);
    } catch (err) {
      next(err);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      const queueId = req.query.queueId as string | undefined;
      let query = db
        .selectFrom("schedules")
        .innerJoin("queues", "queues.id", "schedules.queue_id")
        .innerJoin("projects", "projects.id", "queues.project_id")
        .selectAll("schedules")
        .where("projects.organization_id", "=", req.auth!.orgId);

      if (queueId) query = query.where("schedules.queue_id", "=", queueId);

      const schedules = await query.orderBy("schedules.created_at", "desc").execute();
      res.json({ data: schedules });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/pause", async (req, res, next) => {
    try {
      const updated = await db
        .updateTable("schedules")
        .set({ is_active: false })
        .where("id", "=", req.params.id)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw Errors.notFound("Schedule");
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/resume", async (req, res, next) => {
    try {
      const existing = await db.selectFrom("schedules").selectAll().where("id", "=", req.params.id).executeTakeFirst();
      if (!existing) throw Errors.notFound("Schedule");

      const updated = await db
        .updateTable("schedules")
        .set({ is_active: true, next_run_at: computeNextRun(existing.cron_expression) })
        .where("id", "=", req.params.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
