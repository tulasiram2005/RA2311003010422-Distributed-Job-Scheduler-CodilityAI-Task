import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { Server as SocketServer } from "socket.io";
import { createServer } from "http";
import { createDb, type Database } from "@scheduler/db";
import type { Kysely } from "kysely";
import { createApp } from "../app";
import { signAccessToken } from "../lib/auth";
import { randomUUID } from "crypto";

describe("API", () => {
  let db: Kysely<Database>;
  let app: ReturnType<typeof createApp>;
  let accessToken: string;

  beforeAll(async () => {
    db = createDb();
    const io = new SocketServer(createServer());
    app = createApp(db, io);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const email = `test-${randomUUID()}@example.com`;

  it("rejects registration with an invalid email (validation error shape)", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Test",
      email: "not-an-email",
      password: "password123",
      organizationName: "Test Org",
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("registers a new user and organization", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Test User",
      email,
      password: "password123",
      organizationName: "Test Org",
    });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    accessToken = res.body.accessToken;
  });

  it("gives a fresh signup a default project immediately, with no separate setup step", async () => {
    const freshEmail = `fresh-${randomUUID()}@example.com`;
    const reg = await request(app).post("/api/auth/register").send({
      name: "Fresh Signup",
      email: freshEmail,
      password: "password123",
      organizationName: "Fresh Org",
    });

    expect(reg.status).toBe(201);
    expect(reg.body.project?.id).toBeTruthy();

    // the real regression this guards against: a brand new user should be
    // able to create a queue immediately, with zero prior setup calls
    const queueRes = await request(app)
      .post("/api/queues")
      .set({ Authorization: `Bearer ${reg.body.accessToken}` })
      .send({ projectId: reg.body.project.id, name: "first-queue" });

    expect(queueRes.status).toBe(201);
  });

  it("rejects requests without a bearer token", async () => {
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("full flow: create project -> queue -> job -> retry", async () => {
    const auth = { Authorization: `Bearer ${accessToken}` };

    const projectRes = await request(app).post("/api/projects").set(auth).send({ name: "Flow Test Project" });
    expect(projectRes.status).toBe(201);
    const projectId = projectRes.body.id;

    const queueRes = await request(app).post("/api/queues").set(auth).send({
      projectId,
      name: "flow-test-queue",
      concurrencyLimit: 5,
    });
    expect(queueRes.status).toBe(201);
    const queueId = queueRes.body.id;

    const jobRes = await request(app).post("/api/jobs").set(auth).send({
      queueId,
      jobType: "test_job",
      payload: { hello: "world" },
    });
    expect(jobRes.status).toBe(201);
    expect(jobRes.body.status).toBe("QUEUED");
    const jobId = jobRes.body.id;

    // manually push it into a terminal-ish failure-adjacent state to
    // exercise the retry endpoint's transition guard
    await db.updateTable("jobs").set({ status: "FAILED" }).where("id", "=", jobId).execute();

    const retryRes = await request(app).post(`/api/jobs/${jobId}/retry`).set(auth);
    expect(retryRes.status).toBe(400); // FAILED isn't a manually-retryable state in this API (retries are automatic); only DEAD is
  });

  it("deduplicates job creation via idempotency key", async () => {
    const auth = { Authorization: `Bearer ${accessToken}` };
    const projectRes = await request(app).post("/api/projects").set(auth).send({ name: "Idem Project" });
    const queueRes = await request(app).post("/api/queues").set(auth).send({ projectId: projectRes.body.id, name: "idem-queue" });
    const queueId = queueRes.body.id;
    const idempotencyKey = randomUUID();

    const first = await request(app).post("/api/jobs").set(auth).send({ queueId, jobType: "t", idempotencyKey });
    const second = await request(app).post("/api/jobs").set(auth).send({ queueId, jobType: "t", idempotencyKey });

    expect(first.body.id).toBe(second.body.id);
    expect(second.body.deduplicated).toBe(true);
  });

  it("paginates job listing with a cursor", async () => {
    const auth = { Authorization: `Bearer ${accessToken}` };
    const projectRes = await request(app).post("/api/projects").set(auth).send({ name: "Page Project" });
    const queueRes = await request(app).post("/api/queues").set(auth).send({ projectId: projectRes.body.id, name: "page-queue" });
    const queueId = queueRes.body.id;

    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/jobs").set(auth).send({ queueId, jobType: "t" });
    }

    const page1 = await request(app).get(`/api/jobs?queueId=${queueId}&limit=2`).set(auth);
    expect(page1.body.data.length).toBe(2);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(app).get(`/api/jobs?queueId=${queueId}&limit=2&cursor=${page1.body.nextCursor}`).set(auth);
    expect(page2.body.data.length).toBe(2);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
  });

  it("scopes projects to the caller's organization (cross-tenant isolation)", async () => {
    const otherEmail = `other-${randomUUID()}@example.com`;
    const otherReg = await request(app).post("/api/auth/register").send({
      name: "Other User",
      email: otherEmail,
      password: "password123",
      organizationName: "Other Org",
    });
    const otherToken = otherReg.body.accessToken;

    const myProject = await request(app).post("/api/projects").set({ Authorization: `Bearer ${accessToken}` }).send({ name: "Mine" });

    const crossAccess = await request(app)
      .get(`/api/projects/${myProject.body.id}`)
      .set({ Authorization: `Bearer ${otherToken}` });

    expect(crossAccess.status).toBe(404); // not 403 — we don't confirm existence to a non-owner
  });

  it("enforces role restrictions on structural actions (RBAC is not just declared, it's checked)", async () => {
    const auth = { Authorization: `Bearer ${accessToken}` };
    const ownerProject = await request(app).post("/api/projects").set(auth).send({ name: "RBAC Project" });
    const ownerQueue = await request(app)
      .post("/api/queues")
      .set(auth)
      .send({ projectId: ownerProject.body.id, name: "rbac-queue" });
    expect(ownerQueue.status).toBe(201); // OWNER can create a queue

    // Manually seed a second user as a plain MEMBER of the same org — there's
    // no invite-flow endpoint yet, so this reaches into the DB directly to
    // set up the scenario, the same way a real invite flow eventually would.
    const memberEmail = `member-${randomUUID()}@example.com`;
    const memberUser = await db
      .insertInto("users")
      .values({ email: memberEmail, password_hash: "unused-in-this-test", name: "Plain Member" })
      .returningAll()
      .executeTakeFirstOrThrow();

    const ownerMembership = await db
      .selectFrom("organization_members")
      .selectAll()
      .where("user_id", "=", (await db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirstOrThrow()).id)
      .executeTakeFirstOrThrow();

    await db
      .insertInto("organization_members")
      .values({ organization_id: ownerMembership.organization_id, user_id: memberUser.id, role: "MEMBER" })
      .execute();

    const memberLogin = await request(app).post("/api/auth/login").send({ email: memberEmail, password: "anything" });
    // login will fail on password since we stored an unusable hash — instead
    // mint the token the same way login would, directly, since this test is
    // about role enforcement downstream, not the login flow itself
    expect(memberLogin.status).toBe(401);

    const memberAuthHeader = {
      Authorization: `Bearer ${signAccessToken({ sub: memberUser.id, orgId: ownerMembership.organization_id, role: "MEMBER" })}`,
    };

    const memberCreateQueue = await request(app)
      .post("/api/queues")
      .set(memberAuthHeader)
      .send({ projectId: ownerProject.body.id, name: "member-should-not-create-this" });
    expect(memberCreateQueue.status).toBe(403);
    expect(memberCreateQueue.body.error.code).toBe("FORBIDDEN");

    const memberPause = await request(app).post(`/api/queues/${ownerQueue.body.id}/pause`).set(memberAuthHeader);
    expect(memberPause.status).toBe(403);
  });
});
