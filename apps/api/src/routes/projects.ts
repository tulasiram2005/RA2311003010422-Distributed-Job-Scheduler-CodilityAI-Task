import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import type { Kysely } from "kysely";
import type { Database } from "@scheduler/db";
import { validate } from "../middleware/validate";
import { requireAuth, requireRole } from "../middleware/auth";
import { hashPassword } from "../lib/auth";
import { getOwnedProject } from "../lib/scope";

const createProjectSchema = z.object({ name: z.string().min(1).max(120) });

export function projectsRouter(db: Kysely<Database>): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res, next) => {
    try {
      const projects = await db
        .selectFrom("projects")
        .selectAll()
        .where("organization_id", "=", req.auth!.orgId)
        .orderBy("created_at", "desc")
        .execute();
      res.json({ data: projects.map(withoutKeyHash) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", requireRole("OWNER"), validate(createProjectSchema), async (req, res, next) => {
    try {
      const { name } = req.body as z.infer<typeof createProjectSchema>;
      const apiKey = `sk_${randomBytes(24).toString("hex")}`;
      const project = await db
        .insertInto("projects")
        .values({ organization_id: req.auth!.orgId, name, api_key_hash: await hashPassword(apiKey) })
        .returningAll()
        .executeTakeFirstOrThrow();

      // the raw key is only ever shown once, at creation time
      res.status(201).json({ ...withoutKeyHash(project), apiKey });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const project = await getOwnedProject(db, req.params.id, req.auth!.orgId);
      res.json(withoutKeyHash(project));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function withoutKeyHash<T extends { api_key_hash?: string }>(p: T) {
  const { api_key_hash: _omit, ...rest } = p;
  return rest;
}
