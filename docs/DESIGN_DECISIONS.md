# Design Decisions

## The atomic claim: `SELECT ... FOR UPDATE SKIP LOCKED`

This is the mechanism the whole "no duplicate execution" guarantee rests on, so it's worth spelling out precisely (implementation: `packages/db/src/claim.ts`).

```sql
SELECT id FROM jobs
WHERE queue_id = $1 AND status = 'QUEUED' AND (run_after IS NULL OR run_after <= now())
ORDER BY priority DESC, created_at ASC
LIMIT $2
FOR UPDATE SKIP LOCKED
```

Run inside a transaction, immediately followed by an `UPDATE ... SET status = 'CLAIMED', claimed_by_worker_id = $worker` on those same ids, committed together.

Why this combination and not something simpler:

- Plain `SELECT ... FOR UPDATE` (no `SKIP LOCKED`) would make concurrent workers queue up behind each other's locks instead of skipping past them - worker B would block until worker A commits, then likely select the same rows A just claimed if they're still eligible, or block again on the next batch. It serializes claiming instead of parallelizing it.
- `SELECT` then a separate `UPDATE ... WHERE status = 'QUEUED'` (optimistic, no row lock) is the classic race: two workers can both read the same row as `QUEUED` before either writes, and both think they claimed it. You'd need a `RETURNING` plus row-count check to detect the loser, which works but wastes a round trip on every collision under load.
- Advisory locks (`pg_advisory_lock`) are a good fit for "only one of X should run" problems (e.g. only one instance should run this cron job at a time) but they lock on an arbitrary integer key you choose, not on the rows themselves - using them here would mean locking the whole queue for the duration of a claim, which defeats the point of claiming a batch of jobs efficiently.

`SKIP LOCKED` specifically solves this: the transaction locks whatever it selects, and any concurrent transaction hitting the same `WHERE` clause simply skips past rows it can't lock and takes the next eligible ones instead. Combined with committing the status flip in the same transaction that holds the lock, there is no window where two transactions can both see a row as `QUEUED`.

The composite index `idx_jobs_claim_scan` on `(queue_id, status, priority DESC, created_at ASC)` exists specifically so this query - which runs on every poll tick, from every worker, against every active queue - stays an index scan instead of degrading to a sequential scan as the table grows into the millions of rows.

## Why Postgres over a dedicated broker (Redis/BullMQ, SQS, RabbitMQ)

A dedicated queue broker is usually the better choice for a real production system at scale - this isn't a claim that Postgres beats purpose-built queue infra in general. For this assignment specifically:

- The brief explicitly asks for the claiming/locking mechanism to be designed, not wrapped. Reaching for BullMQ would answer "can you configure a queue library" rather than "can you design the concurrency primitive."
- Relational integrity matters here: jobs reference queues, executions reference jobs, DLQ entries reference jobs and queues. Modeling that in Redis means re-implementing referential integrity by hand; in Postgres it's a foreign key.
- One fewer moving part to operate. A reviewer running this locally needs Postgres either way (for the relational data); adding Redis on top for this scope wouldn't buy much.

The honest trade-off: Postgres-as-queue doesn't scale claim throughput as far as a purpose-built broker eventually would, and polling has a floor that `LISTEN`/`NOTIFY` only pushes so far before it becomes the bottleneck itself. For a system with substantially higher throughput requirements than this one, I'd revisit this.

## Normalization and the one deliberate denormalization

The schema is 3NF throughout, with one intentional exception: `jobs.attempt_count` is a denormalized counter kept in sync inside the same transaction as each `job_executions` insert, rather than computed as `COUNT(*)` on every read. The job list and job detail views render this on every row; recomputing it via a join for every row of every list request would be needless work for a value that only changes once per attempt. `batches.job_count` / `completed_count` / `failed_count` follow the same pattern for the same reason.

## Cascade rules

- `organizations -> projects -> queues -> jobs`: cascading deletes all the way down. Deleting an organization is a deliberate, rare, destructive action; if you do it, you mean it.
- `jobs -> job_executions -> job_logs`: also cascades, for a different reason - these rows have no meaning without their parent job, so an orphaned execution history isn't useful audit trail, it's just clutter.
- `schedules -> jobs.schedule_id` and `batches -> jobs.batch_id` use `ON DELETE SET NULL`, not cascade: deleting a schedule or a batch shouldn't delete the jobs it already spawned. Those jobs already ran (or are running) independently of whether the schedule still exists.
- `workers -> jobs.claimed_by_worker_id` uses `ON DELETE SET NULL` for the same reason - a worker row being cleaned up shouldn't take job history with it.

## Job "kind" as one table, not five

Immediate, delayed, scheduled, batch-member, and recurring-spawned jobs are all rows in one `jobs` table, distinguished by which nullable columns are populated (`run_after`, `scheduled_at`, `batch_id`, `schedule_id`). The alternative - a table per job kind - would mean the claim query (the hottest path in the system) either runs five times per poll tick or the schema needs a view/union to unify them, at which point you've reinvented one table with extra steps. The nullable-column approach costs a bit of schema tidiness; it buys a claim query that only ever has to look in one place.

## Retry strategy and jitter

Three strategies (fixed, linear, exponential) share one function (`packages/shared/src/retry.ts`) rather than three separate code paths, because the only thing that differs between them is the delay formula - duplicating the jitter/cap logic three times would be the kind of copy-paste that drifts out of sync the first time someone tweaks one branch. Jitter is "full jitter" (`random() * delay`, not `delay +/- some offset`) - deliberately wide-variance rather than tightly clustered, following the reasoning in AWS's well-known writeup on backoff and jitter (Marc Brooker, 2015): when many clients fail at the same moment, full jitter spreads their retries out more effectively than a narrower jitter window does, at the cost of some individual retries happening later than strictly necessary.

## Idempotency

A job can carry a caller-supplied `idempotencyKey`. Resubmitting the same key against the same queue returns the existing job instead of creating a duplicate (`apps/api/src/routes/jobs.ts`). This solves the submission-side duplicate problem (a client retries an HTTP request that actually succeeded) but deliberately does not attempt to solve the handler-side duplicate-side-effect problem - if a job's handler sends an email and then the process dies before the job is marked `COMPLETED`, the job will be retried and the email will be sent again. Solving that generally would mean either exactly-once delivery semantics (which distributed systems fundamentally can't guarantee for arbitrary external side effects) or requiring every handler to be idempotent by contract. This system takes the second approach: it guarantees at-least-once execution and gives handlers the tools (the idempotency key, the attempt number) to make themselves safe to re-run, but can't enforce that for handler code it doesn't control.

## What was deliberately not built, and why

- True database-level sharding of the jobs table - logical worker-to-queue-group partitioning (a worker only polling a subset of queues) would give most of the operational benefit at a fraction of the complexity of physically sharding the table, for the scale this assignment targets.
- A message-broker-based event ingestion path - the event-driven bonus item is satisfiable by treating an incoming webhook as "insert a job row," which the existing `POST /api/jobs` already does; a full pub/sub ingestion layer would be solving a scaling problem this system doesn't have yet.
- Per-organization scoping on the `workers` table - workers are modeled as a shared execution fleet visible to any authenticated user, not scoped per-org. In a stricter multi-tenant deployment you'd add a scoping column and filter the way every other router already does; noted here rather than silently left inconsistent.
