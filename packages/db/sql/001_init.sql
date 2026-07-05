-- ============================================================================
-- Distributed Job Scheduler — Initial schema
--
-- Design rationale lives in docs/DESIGN_DECISIONS.md. Quick orientation:
--
--  - `jobs` holds every "kind" of job (immediate/delayed/scheduled/recurring
--    instance/batch member) as one row, distinguished by which nullable
--    columns are populated. The claim query is the hottest path in the whole
--    system (every worker, every poll cycle) so it deliberately scans ONE
--    narrow table against ONE composite index rather than branching across
--    several job-type tables.
--  - `schedules` is the thing that SPAWNS jobs on a cron cadence — it is not
--    itself a job. The scheduler sweep inserts a row into `jobs` each time a
--    schedule fires and stamps `schedule_id` back onto it.
--  - `job_executions` is append-only, one row per attempt, so retry/failure
--    history is a real audit trail rather than being overwritten in place.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Identity & tenancy
-- ---------------------------------------------------------------------------

CREATE TYPE org_role AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            org_role NOT NULL DEFAULT 'MEMBER',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_org_members_user ON organization_members(user_id);

CREATE TABLE projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  api_key_hash    TEXT NOT NULL UNIQUE, -- worker/service-to-service auth, separate from user JWTs
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_org ON projects(organization_id);

-- ---------------------------------------------------------------------------
-- Queues
-- ---------------------------------------------------------------------------

CREATE TABLE queues (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  is_paused         BOOLEAN NOT NULL DEFAULT false,
  concurrency_limit INT NOT NULL DEFAULT 5,
  default_priority  INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TYPE retry_strategy AS ENUM ('FIXED', 'LINEAR', 'EXPONENTIAL');

CREATE TABLE retry_policies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id     UUID NOT NULL UNIQUE REFERENCES queues(id) ON DELETE CASCADE,
  strategy     retry_strategy NOT NULL DEFAULT 'EXPONENTIAL',
  base_delay_ms INT NOT NULL DEFAULT 1000,
  max_delay_ms  INT NOT NULL DEFAULT 300000,
  max_attempts  INT NOT NULL DEFAULT 5,
  use_jitter    BOOLEAN NOT NULL DEFAULT true -- avoids thundering-herd retries when many jobs fail together
);

-- ---------------------------------------------------------------------------
-- Recurring schedules (spawn jobs; are not jobs themselves)
-- ---------------------------------------------------------------------------

CREATE TABLE schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id        UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  next_run_at     TIMESTAMPTZ NOT NULL,
  last_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- covers the sweep query: WHERE is_active AND next_run_at <= now()
CREATE INDEX idx_schedules_due ON schedules(is_active, next_run_at);

-- ---------------------------------------------------------------------------
-- Batches
-- ---------------------------------------------------------------------------

CREATE TABLE batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label           TEXT,
  job_count       INT NOT NULL DEFAULT 0,
  completed_count INT NOT NULL DEFAULT 0,
  failed_count    INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

CREATE TYPE job_status AS ENUM (
  'SCHEDULED', 'QUEUED', 'CLAIMED', 'RUNNING',
  'COMPLETED', 'FAILED', 'RETRYING', 'DEAD', 'CANCELLED'
);

CREATE TABLE jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id         UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  schedule_id      UUID REFERENCES schedules(id) ON DELETE SET NULL,
  batch_id         UUID REFERENCES batches(id) ON DELETE SET NULL,

  job_type         TEXT NOT NULL,          -- application-defined handler name
  payload          JSONB NOT NULL DEFAULT '{}',
  idempotency_key  TEXT,                   -- caller-supplied; resubmits of the same key are no-ops

  status           job_status NOT NULL DEFAULT 'QUEUED',
  priority         INT NOT NULL DEFAULT 0,

  run_after        TIMESTAMPTZ,            -- delayed jobs: not eligible before this
  scheduled_at     TIMESTAMPTZ,            -- scheduled jobs: exact run time
  attempt_count    INT NOT NULL DEFAULT 0,
  max_attempts     INT,                    -- overrides retry_policies.max_attempts if set

  claimed_by_worker_id UUID,
  claimed_at           TIMESTAMPTZ,
  lease_expires_at     TIMESTAMPTZ,        -- if now() > this and status is still CLAIMED/RUNNING, treat as abandoned

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- THE index. Every atomic claim does:
--   WHERE queue_id = $1 AND status = 'QUEUED' ORDER BY priority DESC, created_at ASC
-- This composite index covers that exactly, so claiming stays an index scan
-- even once the table holds millions of historical rows.
CREATE INDEX idx_jobs_claim_scan ON jobs(queue_id, status, priority DESC, created_at ASC);
CREATE INDEX idx_jobs_scheduled_at ON jobs(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX idx_jobs_run_after ON jobs(run_after) WHERE run_after IS NOT NULL;
CREATE INDEX idx_jobs_idempotency ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_jobs_lease_expiry ON jobs(lease_expires_at) WHERE lease_expires_at IS NOT NULL;
CREATE INDEX idx_jobs_batch ON jobs(batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE job_executions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL,
  worker_id      UUID,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  status         job_status NOT NULL,
  error_message  TEXT,
  error_stack    TEXT,
  duration_ms    INT
);
CREATE INDEX idx_job_executions_job ON job_executions(job_id);

CREATE TABLE job_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES job_executions(id) ON DELETE CASCADE,
  level        TEXT NOT NULL DEFAULT 'info',
  message      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_job_logs_execution ON job_logs(execution_id);

CREATE TABLE dead_letter_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  original_queue_id UUID NOT NULL,
  final_error       TEXT NOT NULL,
  moved_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  requeued          BOOLEAN NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------
-- Workers
-- ---------------------------------------------------------------------------

CREATE TYPE worker_status AS ENUM ('ALIVE', 'DRAINING', 'DEAD');

CREATE TABLE workers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname          TEXT NOT NULL,
  pid               INT NOT NULL,
  status            worker_status NOT NULL DEFAULT 'ALIVE',
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_load      INT NOT NULL DEFAULT 0
);
-- covers the dead-worker sweep: WHERE status = 'ALIVE' AND last_heartbeat_at < cutoff
CREATE INDEX idx_workers_liveness ON workers(status, last_heartbeat_at);

ALTER TABLE jobs ADD CONSTRAINT fk_jobs_worker
  FOREIGN KEY (claimed_by_worker_id) REFERENCES workers(id) ON DELETE SET NULL;

CREATE TABLE worker_heartbeats (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id  UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  load       INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_worker_heartbeats_worker ON worker_heartbeats(worker_id, created_at);

-- Tracks how many of a queue's concurrency slots each worker currently holds.
-- Needed to enforce "concurrency limit per queue" across MULTIPLE worker
-- processes polling the same queue, not just within a single process.
CREATE TABLE worker_leases (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id  UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  queue_id   UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  slots      INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, queue_id)
);
