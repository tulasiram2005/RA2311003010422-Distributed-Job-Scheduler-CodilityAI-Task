import type { Kysely } from "kysely";
import type { Database } from "@scheduler/db";
import { Errors } from "./errors";

/** Loads a project and throws 404 if it doesn't exist OR belongs to a different org (same response either way — we don't leak existence across tenants). */
export async function getOwnedProject(db: Kysely<Database>, projectId: string, orgId: string) {
  const project = await db
    .selectFrom("projects")
    .selectAll()
    .where("id", "=", projectId)
    .where("organization_id", "=", orgId)
    .executeTakeFirst();

  if (!project) throw Errors.notFound("Project");
  return project;
}

/** Loads a queue and verifies its parent project belongs to the caller's org. */
export async function getOwnedQueue(db: Kysely<Database>, queueId: string, orgId: string) {
  const queue = await db
    .selectFrom("queues")
    .innerJoin("projects", "projects.id", "queues.project_id")
    .selectAll("queues")
    .where("queues.id", "=", queueId)
    .where("projects.organization_id", "=", orgId)
    .executeTakeFirst();

  if (!queue) throw Errors.notFound("Queue");
  return queue;
}

export async function getOwnedJob(db: Kysely<Database>, jobId: string, orgId: string) {
  const job = await db
    .selectFrom("jobs")
    .innerJoin("queues", "queues.id", "jobs.queue_id")
    .innerJoin("projects", "projects.id", "queues.project_id")
    .selectAll("jobs")
    .where("jobs.id", "=", jobId)
    .where("projects.organization_id", "=", orgId)
    .executeTakeFirst();

  if (!job) throw Errors.notFound("Job");
  return job;
}
