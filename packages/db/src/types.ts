import type { ColumnType, Generated } from "kysely";

// These types are hand-authored against sql/001_init.sql rather than
// generated, since we're not running a codegen step in CI here. If the
// schema changes, update both files together — sql/*.sql is the source of
// truth, this file just describes it to the TypeScript compiler.

export type JobStatus =
  | "SCHEDULED"
  | "QUEUED"
  | "CLAIMED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "RETRYING"
  | "DEAD"
  | "CANCELLED";

export type WorkerStatus = "ALIVE" | "DRAINING" | "DEAD";
export type OrgRole = "OWNER" | "ADMIN" | "MEMBER";
export type RetryStrategyKind = "FIXED" | "LINEAR" | "EXPONENTIAL";

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;
// Generated<S> in Kysely is defined as ColumnType<S, S | undefined, S> — it
// does NOT unwrap a nested ColumnType, so Generated<Timestamp> would make
// the update type "Timestamp" (the type-helper itself) instead of Date.
// This is the correct, already-unwrapped equivalent for a timestamp column
// with a DB-side default (created_at/updated_at-style columns).
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  name: string;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  created_at: GeneratedTimestamp;
}

export interface OrganizationMembersTable {
  id: Generated<string>;
  organization_id: string;
  user_id: string;
  role: Generated<OrgRole>;
  created_at: GeneratedTimestamp;
}

export interface ProjectsTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  api_key_hash: string;
  created_at: GeneratedTimestamp;
}

export interface QueuesTable {
  id: Generated<string>;
  project_id: string;
  name: string;
  description: string | null;
  is_paused: Generated<boolean>;
  concurrency_limit: Generated<number>;
  default_priority: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface RetryPoliciesTable {
  id: Generated<string>;
  queue_id: string;
  strategy: Generated<RetryStrategyKind>;
  base_delay_ms: Generated<number>;
  max_delay_ms: Generated<number>;
  max_attempts: Generated<number>;
  use_jitter: Generated<boolean>;
}

export interface SchedulesTable {
  id: Generated<string>;
  queue_id: string;
  name: string;
  cron_expression: string;
  payload: Generated<unknown>;
  is_active: Generated<boolean>;
  next_run_at: Timestamp;
  last_run_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
}

export interface BatchesTable {
  id: Generated<string>;
  project_id: string;
  label: string | null;
  job_count: Generated<number>;
  completed_count: Generated<number>;
  failed_count: Generated<number>;
  created_at: GeneratedTimestamp;
}

export interface JobsTable {
  id: Generated<string>;
  queue_id: string;
  schedule_id: string | null;
  batch_id: string | null;
  job_type: string;
  payload: Generated<unknown>;
  idempotency_key: string | null;
  status: Generated<JobStatus>;
  priority: Generated<number>;
  run_after: NullableTimestamp;
  scheduled_at: NullableTimestamp;
  attempt_count: Generated<number>;
  max_attempts: number | null;
  claimed_by_worker_id: string | null;
  claimed_at: NullableTimestamp;
  lease_expires_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface JobExecutionsTable {
  id: Generated<string>;
  job_id: string;
  attempt_number: number;
  worker_id: string | null;
  started_at: GeneratedTimestamp;
  finished_at: NullableTimestamp;
  status: JobStatus;
  error_message: string | null;
  error_stack: string | null;
  duration_ms: number | null;
}

export interface JobLogsTable {
  id: Generated<string>;
  execution_id: string;
  level: Generated<string>;
  message: string;
  created_at: GeneratedTimestamp;
}

export interface DeadLetterEntriesTable {
  id: Generated<string>;
  job_id: string;
  original_queue_id: string;
  final_error: string;
  moved_at: GeneratedTimestamp;
  requeued: Generated<boolean>;
}

export interface WorkersTable {
  id: Generated<string>;
  hostname: string;
  pid: number;
  status: Generated<WorkerStatus>;
  last_heartbeat_at: GeneratedTimestamp;
  started_at: GeneratedTimestamp;
  current_load: Generated<number>;
}

export interface WorkerHeartbeatsTable {
  id: Generated<string>;
  worker_id: string;
  load: number;
  created_at: GeneratedTimestamp;
}

export interface WorkerLeasesTable {
  id: Generated<string>;
  worker_id: string;
  queue_id: string;
  slots: Generated<number>;
  updated_at: GeneratedTimestamp;
}

export interface Database {
  users: UsersTable;
  organizations: OrganizationsTable;
  organization_members: OrganizationMembersTable;
  projects: ProjectsTable;
  queues: QueuesTable;
  retry_policies: RetryPoliciesTable;
  schedules: SchedulesTable;
  batches: BatchesTable;
  jobs: JobsTable;
  job_executions: JobExecutionsTable;
  job_logs: JobLogsTable;
  dead_letter_entries: DeadLetterEntriesTable;
  workers: WorkersTable;
  worker_heartbeats: WorkerHeartbeatsTable;
  worker_leases: WorkerLeasesTable;
}
