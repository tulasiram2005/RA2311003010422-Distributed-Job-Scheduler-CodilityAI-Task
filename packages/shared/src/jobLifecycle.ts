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

// The full lifecycle described in the assignment brief is:
//   Queued → Scheduled → Claimed → Running → Completed
// with retries and a DLQ for permanent failures.
//
// In practice SCHEDULED and QUEUED are two different "not yet claimable"
// / "claimable" states rather than a strict sequence — a delayed/scheduled
// job sits in SCHEDULED until its run_after/scheduled_at passes, at which
// point a sweep flips it to QUEUED. An immediate job skips straight to
// QUEUED. Both converge into the same CLAIMED → RUNNING → terminal path.
const LEGAL_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  SCHEDULED: ["QUEUED", "CANCELLED"],
  QUEUED: ["CLAIMED", "CANCELLED"],
  CLAIMED: ["RUNNING", "QUEUED", "CANCELLED"], // QUEUED here = lease-expiry reclaim
  RUNNING: ["COMPLETED", "FAILED", "QUEUED"], // QUEUED here = lease-expiry reclaim mid-execution
  FAILED: ["RETRYING", "DEAD"],
  RETRYING: ["QUEUED"],
  COMPLETED: [],
  DEAD: [],
  CANCELLED: [],
};

export function isValidTransition(from: JobStatus, to: JobStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(from: JobStatus, to: JobStatus) {
    super(`Cannot transition job from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertValidTransition(from: JobStatus, to: JobStatus): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminal(status: JobStatus): boolean {
  return LEGAL_TRANSITIONS[status].length === 0;
}
