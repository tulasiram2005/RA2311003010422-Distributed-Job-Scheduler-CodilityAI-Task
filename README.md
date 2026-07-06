# Distributed Job Scheduler

A production-inspired distributed job scheduling platform: submit immediate, delayed, scheduled, recurring, or batched jobs to a queue; a fleet of worker processes claims and executes them with atomic, race-free claiming; failures retry with configurable backoff and land in a dead letter queue once exhausted.

Built for the "Distributed Job Scheduler" take-home assignment. See `docs/` for architecture, ER diagram, API reference, and the design decisions behind the schema and the concurrency model.

## Stack

| Layer | Tech |
|---|---|
| API | Node.js, TypeScript, Express, Kysely (typed SQL, not an ORM) |
| Worker | Node.js, TypeScript, same `@scheduler/db` package as the API |
| Database | PostgreSQL 16 — raw SQL migrations, no Prisma |
| Frontend | Next.js 14 (App Router), Tailwind, Recharts |
| Realtime | Socket.IO (emitted on job create/retry/requeue; dashboard currently polls, socket wiring is ready to switch on) |
| Tests | Vitest, Supertest — including a real concurrent-claim test against Postgres |

**Why Kysely instead of Prisma:** Prisma's `migrate`/`generate` steps download platform-specific engine binaries from `binaries.prisma.sh` at install/build time. In a network-restricted environment (and in some CI/deploy environments) that download is blocked, which breaks the build entirely. Kysely is pure TypeScript — no native binaries, no build-time network dependency — at the cost of hand-authoring migrations and table types instead of getting them generated. For a schema this size that trade was worth it. See `docs/DESIGN_DECISIONS.md` for the full reasoning.

## Monorepo layout

```
apps/
  api/      Express REST API + WebSocket server
  worker/   Poll -> claim -> execute -> retry/DLQ loop
  web/      Next.js dashboard
packages/
  db/       Kysely client, SQL migrations, atomic claim logic, seed script
  shared/   Retry-delay math, job lifecycle state machine, cron helpers
docs/       Architecture, ER diagram, API reference, design decisions, testing notes
```

## Running it locally

Prerequisites: Node 18+, a local PostgreSQL 16 instance.

```bash
# 1. install everything (npm workspaces)
npm install

# 2. create the database and point at it
createdb jobscheduler
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET

# 3. run migrations
npm run db:migrate

# 4. (optional) seed demo data - an org, a user, three queues, some jobs
npm run db:seed
# logs in as demo@acme.dev / password123

# 5. run everything, each in its own terminal
npm run api:dev      # http://localhost:4000
npm run worker:dev   # no port - polls the DB
npm run web:dev      # http://localhost:3000
```

Then open `http://localhost:3000/login`.

## Trying the retry -> backoff -> dead-letter path without waiting

Two demo job types exist specifically for this (`apps/worker/src/handlers.ts`):

- `flaky_demo` - fails twice, succeeds on the third attempt. Submit it from any queue's detail page and watch the job detail view fill in three execution attempts.
- `always_fails` - always throws. Set a queue's retry policy to a low `maxAttempts` (2-3) to see it land in Dead letter within a few seconds, then use the Requeue button there.

## Testing

```bash
npm run test --workspace=apps/api          # concurrency + lifecycle + API integration tests
npm run test --workspace=packages/shared   # retry-math, state machine, cron unit tests
```

The test that matters most is `apps/api/src/__tests__/concurrentClaim.test.ts`: it spins up 8 concurrent "workers" against a real Postgres instance (not a mock) and asserts that of 40 queued jobs, every single one is claimed by exactly one worker. See `docs/TESTING.md` for what's covered and what isn't.

## Deployment

https://web-ashen-tau-64.vercel.app/login - Live Link
Creditials:
Email: demo@acme.dev
Password: password123

See `docs/DEPLOYMENT.md`. Short version: the Next.js app and the API deploy to Vercel; the worker needs an always-on host (Railway/Render/Fly.io) since Vercel serverless functions can't run a persistent polling loop.
