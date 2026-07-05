import { Router } from "express";
import type { Kysely } from "kysely";
import type { Database } from "@scheduler/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { Errors } from "../lib/errors";
import type { Server as SocketServer } from "socket.io";

export function dlqRouter(db: Kysely<Database>, io: SocketServer): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res, next) => {
    try {
      const queueId = req.query.queueId as string | undefined;
      let query = db
        .selectFrom("dead_letter_entries")
        .innerJoin("jobs", "jobs.id", "dead_letter_entries.job_id")
        .innerJoin("queues", "queues.id", "jobs.queue_id")
        .innerJoin("projects", "projects.id", "queues.project_id")
        .select([
          "dead_letter_entries.id",
          "dead_letter_entries.job_id",
          "dead_letter_entries.final_error",
          "dead_letter_entries.moved_at",
          "dead_letter_entries.requeued",
          "jobs.job_type",
          "jobs.payload",
          "jobs.attempt_count",
          "queues.name as queueName",
        ])
        .where("projects.organization_id", "=", req.auth!.orgId);

      if (queueId) query = query.where("jobs.queue_id", "=", queueId);

      const entries = await query.orderBy("dead_letter_entries.moved_at", "desc").execute();
      res.json({ data: entries });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/requeue", requireRole("OWNER", "ADMIN"), async (req, res, next) => {
    try {
      const entry = await db
        .selectFrom("dead_letter_entries")
        .innerJoin("jobs", "jobs.id", "dead_letter_entries.job_id")
        .innerJoin("queues", "queues.id", "jobs.queue_id")
        .innerJoin("projects", "projects.id", "queues.project_id")
        .select(["dead_letter_entries.id", "jobs.id as jobId", "jobs.queue_id as queueId"])
        .where("dead_letter_entries.id", "=", req.params.id)
        .where("projects.organization_id", "=", req.auth!.orgId)
        .executeTakeFirst();

      if (!entry) throw Errors.notFound("Dead letter entry");

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable("jobs")
          .set({ status: "QUEUED", attempt_count: 0, claimed_by_worker_id: null, claimed_at: null, lease_expires_at: null, updated_at: new Date() })
          .where("id", "=", entry.jobId)
          .execute();
        await trx.updateTable("dead_letter_entries").set({ requeued: true }).where("id", "=", entry.id).execute();
      });

      io.to(`queue:${entry.queueId}`).emit("job:requeued-from-dlq", { jobId: entry.jobId });

      res.json({ requeued: true, jobId: entry.jobId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
