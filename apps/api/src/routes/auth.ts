import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import type { Kysely } from "kysely";
import type { Database } from "@scheduler/db";
import { validate } from "../middleware/validate";
import { comparePassword, hashPassword, signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/auth";
import { Errors } from "../lib/errors";

const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  organizationName: z.string().min(1).max(120),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
}

export function authRouter(db: Kysely<Database>): Router {
  const router = Router();

  router.post("/register", validate(registerSchema), async (req, res, next) => {
    try {
      const { name, email, password, organizationName } = req.body as z.infer<typeof registerSchema>;

      const existing = await db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirst();
      if (existing) throw Errors.conflict("An account with that email already exists");

      const result = await db.transaction().execute(async (trx) => {
        const org = await trx
          .insertInto("organizations")
          .values({ name: organizationName, slug: slugify(organizationName) })
          .returningAll()
          .executeTakeFirstOrThrow();

        const user = await trx
          .insertInto("users")
          .values({ name, email, password_hash: await hashPassword(password) })
          .returningAll()
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("organization_members")
          .values({ organization_id: org.id, user_id: user.id, role: "OWNER" })
          .execute();

        // Without a default project, a fresh signup has nowhere to attach
        // a queue to, and there's no "create project" screen in the
        // dashboard yet — so this is the difference between a new user
        // landing on a working app versus a dead end.
        const project = await trx
          .insertInto("projects")
          .values({
            organization_id: org.id,
            name: "Default Project",
            api_key_hash: await hashPassword(`sk_${randomBytes(24).toString("hex")}`),
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        return { org, user, project };
      });

      const accessToken = signAccessToken({ sub: result.user.id, orgId: result.org.id, role: "OWNER" });
      const refreshToken = signRefreshToken(result.user.id);

      res.status(201).json({
        user: { id: result.user.id, name: result.user.name, email: result.user.email },
        organization: { id: result.org.id, name: result.org.name, slug: result.org.slug },
        project: { id: result.project.id, name: result.project.name },
        accessToken,
        refreshToken,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", validate(loginSchema), async (req, res, next) => {
    try {
      const { email, password } = req.body as z.infer<typeof loginSchema>;

      const user = await db.selectFrom("users").selectAll().where("email", "=", email).executeTakeFirst();
      if (!user || !(await comparePassword(password, user.password_hash))) {
        throw Errors.unauthorized("Invalid email or password");
      }

      const membership = await db
        .selectFrom("organization_members")
        .innerJoin("organizations", "organizations.id", "organization_members.organization_id")
        .select(["organization_members.role", "organizations.id as orgId", "organizations.name as orgName"])
        .where("organization_members.user_id", "=", user.id)
        .executeTakeFirst();

      if (!membership) throw Errors.forbidden("User does not belong to an organization");

      const accessToken = signAccessToken({ sub: user.id, orgId: membership.orgId, role: membership.role });
      const refreshToken = signRefreshToken(user.id);

      res.json({
        user: { id: user.id, name: user.name, email: user.email },
        organization: { id: membership.orgId, name: membership.orgName },
        accessToken,
        refreshToken,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/refresh", validate(refreshSchema), async (req, res, next) => {
    try {
      const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
      let payload: { sub: string };
      try {
        payload = verifyRefreshToken(refreshToken);
      } catch {
        throw Errors.unauthorized("Invalid or expired refresh token");
      }

      const membership = await db
        .selectFrom("organization_members")
        .select(["role", "organization_id"])
        .where("user_id", "=", payload.sub)
        .executeTakeFirst();

      if (!membership) throw Errors.unauthorized();

      const accessToken = signAccessToken({ sub: payload.sub, orgId: membership.organization_id, role: membership.role });
      res.json({ accessToken });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
