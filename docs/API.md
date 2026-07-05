# API Reference

Base URL (local): `http://localhost:4000`. All routes except `/health` and `/api/auth/*` require `Authorization: Bearer <accessToken>`.

Every error response has the shape:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": { } } }
```

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password, organizationName }` | Creates a user + a new organization, returns tokens |
| POST | `/api/auth/login` | `{ email, password }` | Returns `accessToken` (15m) + `refreshToken` (7d) |
| POST | `/api/auth/refresh` | `{ refreshToken }` | Returns a new `accessToken` |

## Projects

| Method | Path | Notes |
|---|---|---|
| GET | `/api/projects` | List projects in the caller's org |
| POST | `/api/projects` | `{ name }` - response includes the raw `apiKey` once, never again |
| GET | `/api/projects/:id` | 404 if it belongs to a different org |

## Queues

| Method | Path | Body |
|---|---|---|
| GET | `/api/queues?projectId=` | |
| POST | `/api/queues` | `{ projectId, name, description?, concurrencyLimit?, defaultPriority?, retryPolicy? { strategy, baseDelayMs, maxDelayMs, maxAttempts, useJitter } }` |
| GET | `/api/queues/:id` | includes `retryPolicy` |
| PATCH | `/api/queues/:id` | `{ description?, concurrencyLimit?, defaultPriority? }` |
| POST | `/api/queues/:id/pause` | |
| POST | `/api/queues/:id/resume` | |
| GET | `/api/queues/:id/stats` | status counts, completions in the last hour, avg duration |

## Jobs

| Method | Path | Body |
|---|---|---|
| POST | `/api/jobs` | `{ queueId, jobType, payload?, priority?, idempotencyKey?, maxAttempts?, runAfter? (ISO), scheduledAt? (ISO) }` - omit both `runAfter`/`scheduledAt` for an immediate job |
| POST | `/api/jobs/batch` | `{ queueId, label?, jobs: [{ jobType, payload?, priority? }, ...] }` (max 1000) |
| GET | `/api/jobs?queueId=&status=&jobType=&from=&to=&cursor=&limit=` | cursor-paginated, `limit` max 100 |
| GET | `/api/jobs/:id` | includes `executions[]` and `logs[]` |
| POST | `/api/jobs/:id/retry` | Only valid from `DEAD` (manual re-queue); automatic retries from `FAILED` happen on their own via backoff |
| POST | `/api/jobs/:id/cancel` | Only valid from non-terminal states |

## Schedules (recurring jobs)

| Method | Path | Body |
|---|---|---|
| POST | `/api/schedules` | `{ queueId, name, cronExpression, payload? }` |
| GET | `/api/schedules?queueId=` | |
| POST | `/api/schedules/:id/pause` | |
| POST | `/api/schedules/:id/resume` | recomputes `next_run_at` from now |

## Workers

| Method | Path | Notes |
|---|---|---|
| GET | `/api/workers` | includes computed `isStale` (heartbeat older than 30s) |
| GET | `/api/workers/:id/leases` | concurrency slots this worker currently holds, per queue |
| GET | `/api/workers/summary` | counts grouped by status |

## Dead letter queue

| Method | Path | Notes |
|---|---|---|
| GET | `/api/dlq?queueId=` | |
| POST | `/api/dlq/:id/requeue` | resets `attempt_count` to 0 and status to `QUEUED` |

## Metrics

| Method | Path | Notes |
|---|---|---|
| GET | `/api/metrics/overview` | status counts, 60-minute throughput series (per-minute buckets), p95 execution duration, active worker count |

## WebSocket events (Socket.IO)

Client emits `subscribe:queue` / `unsubscribe:queue` with a queue id to join/leave a room. Server emits into `queue:<id>`:

- `job:created` - `{ jobId, queueId, status }`
- `batch:created` - `{ batchId, count }`
- `job:retried` - `{ jobId, queueId }`
- `job:requeued-from-dlq` - `{ jobId }`
