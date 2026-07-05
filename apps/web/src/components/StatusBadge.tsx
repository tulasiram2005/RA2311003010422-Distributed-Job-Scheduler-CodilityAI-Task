const LABELS: Record<string, string> = {
  SCHEDULED: "scheduled",
  QUEUED: "queued",
  CLAIMED: "claimed",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  RETRYING: "retrying",
  DEAD: "dead letter",
  CANCELLED: "cancelled",
};

const DOT_CLASS: Record<string, string> = {
  SCHEDULED: "bg-status-scheduled",
  QUEUED: "bg-status-queued",
  CLAIMED: "bg-status-claimed",
  RUNNING: "bg-status-running",
  COMPLETED: "bg-status-completed",
  FAILED: "bg-status-failed",
  RETRYING: "bg-status-retrying",
  DEAD: "bg-status-dead",
  CANCELLED: "bg-status-cancelled",
};

export function StatusBadge({ status }: { status: string }) {
  const pulse = status === "RUNNING";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-base-600 bg-base-800 px-2 py-0.5 font-mono text-2xs uppercase tracking-wide text-ink-300">
      <span className={`relative h-1.5 w-1.5 rounded-full ${DOT_CLASS[status] ?? "bg-ink-500"}`}>
        {pulse && <span className={`absolute inset-0 rounded-full ${DOT_CLASS[status]} animate-ping opacity-75`} />}
      </span>
      {LABELS[status] ?? status.toLowerCase()}
    </span>
  );
}
