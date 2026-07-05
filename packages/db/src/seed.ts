import { createDb } from "./index";
import { randomUUID } from "crypto";
import { hash } from "bcryptjs";

async function main() {
  const db = createDb();

  console.log("seeding...");

  const org = await db
    .insertInto("organizations")
    .values({ name: "Acme Logistics", slug: "acme-logistics" })
    .returningAll()
    .executeTakeFirstOrThrow();

  const passwordHash = await hash("password123", 10);
  const user = await db
    .insertInto("users")
    .values({
      email: "demo@acme.dev",
      password_hash: passwordHash,
      name: "Demo User",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db
    .insertInto("organization_members")
    .values({ organization_id: org.id, user_id: user.id, role: "OWNER" })
    .execute();

  const project = await db
    .insertInto("projects")
    .values({
      organization_id: org.id,
      name: "Fulfillment Platform",
      api_key_hash: await hash(`sk_${randomUUID()}`, 4),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const queueDefs = [
    { name: "email-notifications", concurrency_limit: 8, default_priority: 5 },
    { name: "report-generation", concurrency_limit: 3, default_priority: 2 },
    { name: "order-sync", concurrency_limit: 10, default_priority: 8 },
  ];

  for (const qd of queueDefs) {
    const queue = await db
      .insertInto("queues")
      .values({ project_id: project.id, ...qd })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto("retry_policies")
      .values({
        queue_id: queue.id,
        strategy: "EXPONENTIAL",
        base_delay_ms: 1000,
        max_delay_ms: 60000,
        max_attempts: 5,
        use_jitter: true,
      })
      .execute();

    // a handful of jobs in various lifecycle states so the dashboard has
    // something real to render on first load
    const statuses = ["COMPLETED", "COMPLETED", "COMPLETED", "FAILED", "QUEUED", "RUNNING"] as const;
    for (let i = 0; i < statuses.length; i++) {
      await db
        .insertInto("jobs")
        .values({
          queue_id: queue.id,
          job_type: qd.name === "email-notifications" ? "send_email" : qd.name === "report-generation" ? "generate_report" : "sync_order",
          payload: JSON.stringify({ demo: true, seq: i }),
          status: statuses[i],
          priority: qd.default_priority,
          attempt_count: statuses[i] === "FAILED" ? 2 : statuses[i] === "COMPLETED" ? 1 : 0,
        })
        .execute();
    }
  }

  console.log(`seeded org=${org.slug} user=${user.email} (password: password123)`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
