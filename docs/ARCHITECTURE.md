# Architecture

## Components

```
                         +--------------+
                         |   Next.js    |
                         |   Dashboard  |  polls REST, subscribes to
                         |  (apps/web)  |  Socket.IO for live events
                         +------+-------+
                                | HTTPS
                                v
                         +--------------+
                         |  Express API |  auth, validation, project
                         |  (apps/api)  |  scoping, Socket.IO server
                         +------+-------+
                                |
                    +-----------+------------+
                    v                        v
             +-------------+          +-------------+
             |  PostgreSQL |<-------->|   Worker(s) |
             |  (shared    |  polls,  | (apps/worker)|
             |   state)    |  claims  |  N processes |
             +-------------+  jobs    +-------------+
```

The API and the worker are **separate processes that never talk to each other directly.** Postgres is the only shared state between them. This is deliberate: it means either side can be scaled, restarted, or redeployed independently, and it's what makes the atomic-claim mechanism (below) work — if the worker had to ask the API "can I have a job?", the API would become the bottleneck and a second point of failure for something that's supposed to be exactly one thing: reliable delivery of a job to exactly one worker.

## Why the worker isn't just "part of the API"

Running job execution inline inside API request handlers is the first thing people try, and it breaks down fast: a slow job blocks the request that submitted it (or, worse, someone builds a fire-and-forget `setTimeout` and loses jobs on every deploy). Splitting them means:

- The API stays fast and stateless-per-request; it only ever does short-lived DB queries.
- Workers can be scaled to the size of the backlog, independent of how much API traffic there is.
- A worker crash doesn't take the API down, and an API restart doesn't lose in-flight jobs (their lease just expires and the sweep reclaims them).

## Request lifecycle for a job

1. Client calls `POST /api/jobs` -> API validates, resolves the owning queue, inserts a row with status `QUEUED` (or `SCHEDULED` if `runAfter`/`scheduledAt` was given).
2. Every worker process independently polls each active queue on a timer (`POLL_INTERVAL_MS`, default 1s).
3. A worker calls `claimJobs()` - a single transaction using `SELECT ... FOR UPDATE SKIP LOCKED` - which atomically finds up to N eligible jobs, locks them, and flips them to `CLAIMED` with `claimed_by_worker_id` and a `lease_expires_at`, all before releasing the row lock. No two workers can ever walk away with the same row; see `docs/DESIGN_DECISIONS.md` for the full mechanics.
4. The worker flips the job to `RUNNING` and invokes the registered handler for `job_type`.
5. On success: `COMPLETED`, one `job_executions` row written.
6. On failure: a `job_executions` row is written with the error, then either:
   - attempts remaining -> `RETRYING`, with `run_after` set to `now() + backoff(attempt)`, or
   - attempts exhausted -> `DEAD`, plus a `dead_letter_entries` row.
7. A separate sweep loop (`SWEEP_INTERVAL_MS`, default 3s) does three things every tick:
   - reclaims jobs whose `lease_expires_at` passed while still `CLAIMED`/`RUNNING` (the worker holding them is presumed dead) back to `QUEUED`,
   - promotes `SCHEDULED`/`RETRYING` jobs whose wait time has elapsed to `QUEUED`,
   - fires any `schedules` row whose `next_run_at` has passed, spawning a new `jobs` row and advancing `next_run_at`.

## Concurrency enforcement across the fleet

A queue's `concurrency_limit` caps how many jobs may be running at once across every worker, not per worker. `worker_leases` tracks how many slots each worker currently holds against each queue; before claiming, a worker sums that column for the queue, subtracts from the limit, and only claims up to the remainder. This is what stops five workers from each independently deciding "I can run 5 more" against a queue whose limit is 5.

## Failure modes and how they're handled

| Failure | Handling |
|---|---|
| Two workers claim at the same instant | `FOR UPDATE SKIP LOCKED` - see DESIGN_DECISIONS.md |
| Worker process crashes mid-job | Lease expires (`lease_expires_at`), sweep requeues it; the in-progress `job_executions` row (if written) shows the abandoned attempt |
| Worker killed via SIGTERM (deploy, scale-down) | Stops claiming immediately, waits up to `SHUTDOWN_GRACE_MS` for in-flight jobs to finish, releases its leases, marks itself `DEAD` |
| Downstream dependency flaps, many jobs fail at once | Full jitter on backoff spreads retries out instead of a synchronized retry storm |
| Job's handler throws after partial side effects | Idempotency key on the job payload lets the caller's resubmission be a no-op; the handler itself is responsible for being safe to re-run, which is a contract this system can support but can't enforce for arbitrary handler code |
| API instance restarts mid-request | Nothing job-related is held in API memory; a submitted-but-not-yet-committed job simply isn't inserted, so there's no partial state to clean up |
