"use client";

import useSWR from "swr";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHeader, Panel, SkeletonRows } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { api, ApiError } from "@/lib/api";
import { useState } from "react";

interface Execution {
  id: string;
  attempt_number: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
}

interface LogLine {
  id: string;
  execution_id: string;
  level: string;
  message: string;
  created_at: string;
}

interface JobDetail {
  id: string;
  job_type: string;
  status: string;
  priority: number;
  payload: unknown;
  attempt_count: number;
  created_at: string;
  executions: Execution[];
  logs: LogLine[];
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: job, mutate } = useSWR(`job-${id}`, () => api.get<JobDetail>(`/api/jobs/${id}`), { refreshInterval: 3000 });
  const [actionError, setActionError] = useState<string | null>(null);

  async function retry() {
    setActionError(null);
    try {
      await api.post(`/api/jobs/${id}/retry`);
      mutate();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Retry failed");
    }
  }

  if (!job) {
    return (
      <AppShell>
        <SkeletonRows rows={6} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title={job.job_type}
        description={`Job ${job.id}`}
        action={
          <div className="flex items-center gap-3">
            <StatusBadge status={job.status} />
            {job.status === "DEAD" && (
              <button onClick={retry} className="rounded-sm bg-status-queued px-3 py-1.5 text-sm font-medium text-base-950 hover:opacity-90">
                Retry
              </button>
            )}
          </div>
        }
      />
      {actionError && <p className="mb-3 text-sm text-status-failed">{actionError}</p>}
      {job.status === "FAILED" && (
        <p className="mb-3 text-sm text-ink-500">
          This attempt failed — it will automatically retry with backoff shortly. No action needed.
        </p>
      )}
      {job.status === "RETRYING" && (
        <p className="mb-3 text-sm text-status-running">Waiting out its backoff delay before the next attempt.</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Execution timeline">
            {job.executions.length === 0 ? (
              <p className="text-sm text-ink-700">Not yet claimed by a worker.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-base-700 pl-4">
                {job.executions.map((exec) => (
                  <li key={exec.id} className="relative">
                    <span
                      className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${
                        exec.status === "COMPLETED" ? "bg-status-completed" : "bg-status-failed"
                      }`}
                    />
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm text-ink-100">attempt {exec.attempt_number}</span>
                      <span className="text-2xs text-ink-500">{exec.duration_ms != null ? `${exec.duration_ms}ms` : ""}</span>
                    </div>
                    <div className="text-2xs text-ink-500">{new Date(exec.started_at).toLocaleString()}</div>
                    {exec.error_message && <div className="mt-1 text-sm text-status-failed">{exec.error_message}</div>}

                    {job.logs.filter((l) => l.execution_id === exec.id).length > 0 && (
                      <pre className="mt-2 max-h-32 overflow-y-auto rounded-sm border border-base-700 bg-base-950 p-2 font-mono text-2xs text-ink-500">
                        {job.logs
                          .filter((l) => l.execution_id === exec.id)
                          .map((l) => `[${new Date(l.created_at).toLocaleTimeString()}] ${l.message}`)
                          .join("\n")}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <Panel title="Details">
          <dl className="space-y-2 text-sm">
            <Row label="Priority" value={String(job.priority)} />
            <Row label="Attempts" value={String(job.attempt_count)} />
            <Row label="Created" value={new Date(job.created_at).toLocaleString()} />
          </dl>
          <div className="mt-4">
            <div className="mb-1 text-2xs uppercase tracking-wide text-ink-500">Payload</div>
            <pre className="max-h-48 overflow-y-auto rounded-sm border border-base-700 bg-base-950 p-2 font-mono text-2xs text-ink-300">
              {JSON.stringify(job.payload, null, 2)}
            </pre>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-mono text-ink-100">{value}</dd>
    </div>
  );
}
