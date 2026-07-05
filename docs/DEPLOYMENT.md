# Deployment

## The constraint that shapes this whole guide

Vercel's serverless functions are stateless and time-limited - they spin up per request and shut down shortly after. The worker needs the opposite: one process that stays alive indefinitely, polling the database on a timer and holding open connections. That process cannot run on Vercel. This isn't an oversight to route around later; it's a real platform boundary, and the deployment below is split accordingly.

| Component | Where | Why |
|---|---|---|
| `apps/web` (Next.js dashboard) | Vercel | Exactly what Vercel is built for |
| `apps/api` (Express + Socket.IO) | Vercel, or Railway if you want persistent WebSockets | See note below |
| `apps/worker` | Railway / Render / Fly.io / a small VPS | Needs to run continuously |
| Postgres | Neon / Supabase / Railway Postgres | Managed, pairs well with either host above |

**Note on the API + Socket.IO:** Vercel's serverless functions don't hold persistent WebSocket connections well - each invocation is short-lived. For a deployment that wants live Socket.IO updates rather than the dashboard's current polling fallback, deploy `apps/api` to the same always-on host as the worker (Railway/Render) instead of Vercel. The REST endpoints work fine either way; it's specifically the WebSocket layer that wants a long-lived process.

## Step by step

### 1. Database - Neon (or Supabase)

1. Create a project at neon.tech, copy the connection string.
2. From a machine with network access to it: `DATABASE_URL="<neon-url>" npm run db:migrate --workspace=packages/db`
3. Optionally seed: `DATABASE_URL="<neon-url>" npm run db:seed --workspace=packages/db`

### 2. Worker - Railway (or Render/Fly)

1. New Railway project, deploy from this repo, root directory `apps/worker`.
2. Start command: `npm run start --workspace=apps/worker`.
3. Environment variables: `DATABASE_URL` (same Neon URL), plus optionally `POLL_INTERVAL_MS`, `SWEEP_INTERVAL_MS`, `HEARTBEAT_INTERVAL_MS`, `MAX_CLAIM_PER_QUEUE_PER_TICK`, `SHUTDOWN_GRACE_MS` to tune it.
4. No exposed port needed - it doesn't serve HTTP.

### 3. API - Vercel

`vercel.json` at the repo root:

```json
{
  "version": 2,
  "builds": [{ "src": "apps/api/src/server.ts", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "apps/api/src/server.ts" }]
}
```

Environment variables in the Vercel project settings: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `NODE_ENV=production`.

If you want real-time Socket.IO instead of the dashboard's polling fallback, deploy the API to Railway alongside the worker instead - same build/start commands as the worker section above, pointing at `apps/api`.

### 4. Web - Vercel

1. New Vercel project, root directory `apps/web`, framework preset Next.js (auto-detected).
2. Environment variable: `NEXT_PUBLIC_API_URL=https://<your-api-domain>`.
3. Deploy. Vercel handles the build (`next build`) and CDN automatically.

## Post-deploy checklist

- [ ] `curl https://<api-domain>/health` returns `{"status":"ok",...}`
- [ ] Worker logs show `worker started` and periodic heartbeat activity
- [ ] `GET /api/workers` from the deployed API shows the worker as `ALIVE`
- [ ] Submitting a job from the deployed dashboard results in it reaching `COMPLETED` within a few seconds
- [ ] If asked "why is the worker on a different host than the API," point to this file - it's a platform constraint, not an oversight, and saying so out loud is itself a signal of understanding the deployment target.
