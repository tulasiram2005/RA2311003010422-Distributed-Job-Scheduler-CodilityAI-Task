import { Router } from "express";
import { sql, type Kysely } from "kysely";
import type { Database } from "@scheduler/db";
import { requireAuth } from "../middleware/auth";

// Note: workers aren't org-scoped in the schema (they're a shared execution
// fleet that can serve many projects), so this returns the full fleet view
// to any authenticated user. In a stricter multi-tenant deployment you'd add
// a project_id/org_id column to `workers` and filter here the same way the
// other routers do — noted in DESIGN_DECISIONS.md as a deliberate scope cut.
export function workersRouter(db: Kysely<Database>): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (_req, res, next) => {
    try {
      const workers = await db.selectFrom("workers").selectAll().orderBy("last_heartbeat_at", "desc").execute();

      // a worker is considered dead in the UI if its heartbeat is stale,
      // even if the DB row's `status` column hasn't been swept yet
      const STALE_MS = 30_000;
      const now = Date.now();
      const withLiveness = workers.map((w) => ({
        ...w,
        isStale: now - new Date(w.last_heartbeat_at).getTime() > STALE_MS,
      }));

      res.json({ data: withLiveness });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/leases", async (req, res, next) => {
    try {
      const leases = await db
        .selectFrom("worker_leases")
        .innerJoin("queues", "queues.id", "worker_leases.queue_id")
        .select(["worker_leases.queue_id", "queues.name as queueName", "worker_leases.slots"])
        .where("worker_leases.worker_id", "=", req.params.id)
        .execute();
      res.json({ data: leases });
    } catch (err) {
      next(err);
    }
  });

  router.get("/summary", async (_req, res, next) => {
    try {
      const summary = await sql<{ status: string; count: string }>`
        SELECT status, count(*) FROM workers GROUP BY status
      `.execute(db);
      res.json({ data: Object.fromEntries(summary.rows.map((r) => [r.status, Number(r.count)])) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
