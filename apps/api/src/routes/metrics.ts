import { Router } from "express";
import { sql, type Kysely } from "kysely";
import type { Database } from "@scheduler/db";
import { requireAuth } from "../middleware/auth";

export function metricsRouter(db: Kysely<Database>): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/overview", async (req, res, next) => {
    try {
      const orgId = req.auth!.orgId;

      const statusCounts = await sql<{ status: string; count: string }>`
        SELECT j.status, count(*) FROM jobs j
        JOIN queues q ON q.id = j.queue_id
        JOIN projects p ON p.id = q.project_id
        WHERE p.organization_id = ${orgId}
        GROUP BY j.status
      `.execute(db);

      const throughputSeries = await sql<{ bucket: string; completed: string; failed: string }>`
        SELECT date_trunc('minute', je.finished_at) as bucket,
               count(*) FILTER (WHERE je.status = 'COMPLETED') as completed,
               count(*) FILTER (WHERE je.status = 'FAILED') as failed
        FROM job_executions je
        JOIN jobs j ON j.id = je.job_id
        JOIN queues q ON q.id = j.queue_id
        JOIN projects p ON p.id = q.project_id
        WHERE p.organization_id = ${orgId}
          AND je.finished_at > now() - interval '60 minutes'
        GROUP BY bucket
        ORDER BY bucket ASC
      `.execute(db);

      const p95 = await sql<{ p95_ms: number | null }>`
        SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY je.duration_ms) as p95_ms
        FROM job_executions je
        JOIN jobs j ON j.id = je.job_id
        JOIN queues q ON q.id = j.queue_id
        JOIN projects p ON p.id = q.project_id
        WHERE p.organization_id = ${orgId} AND je.status = 'COMPLETED'
      `.execute(db);

      const activeWorkers = await sql<{ count: string }>`
        SELECT count(*) FROM workers WHERE status = 'ALIVE' AND last_heartbeat_at > now() - interval '30 seconds'
      `.execute(db);

      res.json({
        statusCounts: Object.fromEntries(statusCounts.rows.map((r) => [r.status, Number(r.count)])),
        throughputSeries: throughputSeries.rows.map((r) => ({
          bucket: r.bucket,
          completed: Number(r.completed),
          failed: Number(r.failed),
        })),
        p95DurationMs: p95.rows[0]?.p95_ms ?? null,
        activeWorkers: Number(activeWorkers.rows[0]?.count ?? 0),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
