# Testing

32 tests, all passing, split across two workspaces:

```
packages/shared   20 tests  - retry delay math, job lifecycle state machine, cron helpers
apps/api          12 tests  - concurrent claim correctness, API integration, RBAC enforcement
```

## What's covered and why it's the right thing to cover

**`concurrentClaim.test.ts` is the centerpiece.** It runs against a real local Postgres instance - not a mock - because the entire guarantee under test (`FOR UPDATE SKIP LOCKED` never letting two transactions claim the same row) is a property of real database locking behavior that a mocked query builder cannot reproduce. The test spins up 8 concurrent "workers" claiming from a shared queue of 40 jobs in repeated rounds until the queue drains, then asserts:

- every claimed job id is unique across all workers and all rounds,
- every job that existed got claimed by exactly one worker,
- no job was left in `QUEUED` afterward,
- every claimed row has both `status = CLAIMED` and a non-null `claimed_by_worker_id`.

It also separately verifies claim ordering (priority first) and that `run_after`-delayed jobs aren't claimed early.

**Retry math (`retry.test.ts`)** checks each strategy's formula in isolation with jitter disabled (so the assertions are exact), then a separate jitter test asserts the output stays within `[0, computed_delay]` across many samples rather than asserting an exact value, which would be flaky by construction since jitter is random.

**State machine (`jobLifecycle.test.ts`)** asserts both the happy paths and, just as importantly, that illegal transitions are rejected - e.g. `QUEUED -> COMPLETED` directly, or any transition out of a terminal state.

**Cron (`cron.test.ts`)** checks next-run computation against fixed reference dates (not "now", to keep the test deterministic) and that invalid expressions throw a clear error rather than silently misbehaving.

**API integration (`api.test.ts`)** covers auth (register/login/validation-error-shape), the full project -> queue -> job -> retry flow through real HTTP requests via Supertest, idempotency-key deduplication, cursor pagination, cross-tenant isolation (a user from one organization gets a 404, not a 403, when requesting another organization's project), and role enforcement — a manually-seeded `MEMBER`-role user is asserted to get a real `403 FORBIDDEN` when attempting to create a queue or pause one, proving `requireRole` is wired into the routes and not just defined in the middleware file unused.

## What isn't covered, and why that's a deliberate scope decision rather than an oversight

- **The worker process itself (`apps/worker`) has no automated tests.** Its core logic - the claim call, the retry/DLQ branching - is exercised indirectly through `concurrentClaim.test.ts` (which calls the same `claimJobs` function the worker calls) and through the manual end-to-end runs described in the README (the `flaky_demo` and `always_fails` handlers exist specifically to make those manual runs fast and repeatable). Testing the worker's poll loop itself would mean either mocking timers in a way that risks testing the mock instead of the behavior, or running a real multi-second integration test in CI - for this assignment's scope, the manual verification path was the better use of time than either.
- **The frontend has no test suite.** It's a thin, mostly-presentational layer over the API; the API's own tests are what actually validate correctness. If this were headed to production, the highest-value frontend tests would be the job-creation and retry forms, since they're the only places the frontend does anything beyond rendering fetched data.
- **Load/throughput testing** (how many jobs/sec one worker can actually process) wasn't measured. The concurrency test proves correctness under contention, not throughput under load - those are different questions, and the second one wasn't in scope here.
