"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHeader, Panel, StatCard, EmptyState, SkeletonCards } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { api, ApiError } from "@/lib/api";
import { useQueueLiveUpdates } from "@/lib/liveUpdates";
import Link from "next/link";

interface QueueDetail {
  id: string;
  name: string;
  description: string | null;
  is_paused: boolean;
  concurrency_limit: number;
  retryPolicy: { strategy: string; base_delay_ms: number; max_delay_ms: number; max_attempts: number; use_jitter: boolean } | null;
}

interface Stats {
  counts: Record<string, number>;
  completedLastHour: number;
  avgDurationMs: number | null;
}

interface JobRow {
  id: string;
  job_type: string;
  status: string;
  priority: number;
  attempt_count: number;
  created_at: string;
}

export default function QueueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: queue } = useSWR(`queue-${id}`, () => api.get<QueueDetail>(`/api/queues/${id}`));
  const { data: stats, mutate: refetchStats } = useSWR(`queue-${id}-stats`, () => api.get<Stats>(`/api/queues/${id}/stats`), {
    refreshInterval: 5000,
  });
  const { data: jobs, mutate: refetchJobs } = useSWR(`queue-${id}-jobs`, () => api.get<{ data: JobRow[] }>(`/api/jobs?queueId=${id}&limit=20`), {
    refreshInterval: 5000,
  });

  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useQueueLiveUpdates(id);

  async function createJob(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const runAfterMinutes = Number(form.get("delayMinutes") || 0);
    try {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(String(form.get("payload") || "{}"));
      } catch {
        throw new Error("Payload must be valid JSON");
      }

      await api.post("/api/jobs", {
        queueId: id,
        jobType: String(form.get("jobType")),
        payload,
        priority: Number(form.get("priority") || 0),
        ...(runAfterMinutes > 0 ? { runAfter: new Date(Date.now() + runAfterMinutes * 60000).toISOString() } : {}),
      });
      setShowForm(false);
      refetchJobs();
      refetchStats();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to create job");
    }
  }

  if (!queue) {
    return (
      <AppShell>
        <SkeletonCards count={4} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title={queue.name}
        description={queue.description ?? undefined}
        action={
          <button onClick={() => setShowForm((s) => !s)} className="rounded-sm bg-status-queued px-3 py-1.5 text-sm font-medium text-base-950 hover:opacity-90">
            Submit job
          </button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Queued" value={stats?.counts.QUEUED ?? 0} />
        <StatCard label="Running" value={stats?.counts.RUNNING ?? 0} tone="text-status-running" />
        <StatCard label="Completed / hr" value={stats?.completedLastHour ?? 0} tone="text-status-completed" />
        <StatCard label="Avg duration" value={stats?.avgDurationMs ? `${stats.avgDurationMs}ms` : "—"} />
      </div>

      {showForm && (
        <div className="mb-5">
          <Panel title="Submit a job to this queue">
            <form onSubmit={createJob} className="grid grid-cols-3 gap-3">
              <label className="col-span-2 block">
                <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-500">Job type</span>
                <input name="jobType" required placeholder="send_email" className="w-full rounded-sm border border-base-600 bg-base-800 px-3 py-2 text-sm text-ink-100 outline-none focus:border-status-queued" />
              </label>
              <label className="block">
                <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-500">Priority</span>
                <input name="priority" type="number" defaultValue={0} className="w-full rounded-sm border border-base-600 bg-base-800 px-3 py-2 text-sm text-ink-100 outline-none focus:border-status-queued" />
              </label>
              <label className="col-span-2 block">
                <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-500">Payload (JSON)</span>
                <textarea name="payload" rows={2} defaultValue="{}" className="w-full rounded-sm border border-base-600 bg-base-800 px-3 py-2 font-mono text-sm text-ink-100 outline-none focus:border-status-queued" />
              </label>
              <label className="block">
                <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-500">Delay (minutes, 0 = now)</span>
                <input name="delayMinutes" type="number" defaultValue={0} min={0} className="w-full rounded-sm border border-base-600 bg-base-800 px-3 py-2 text-sm text-ink-100 outline-none focus:border-status-queued" />
              </label>
              {error && <p className="col-span-3 text-sm text-status-failed">{error}</p>}
              <button type="submit" className="col-span-3 rounded-sm bg-status-queued py-2 text-sm font-medium text-base-950 hover:opacity-90">
                Submit
              </button>
            </form>
          </Panel>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Recent jobs">
            {(jobs?.data ?? []).length === 0 ? (
              <EmptyState title="No jobs yet" description="Submit a job above to see it appear here." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-2xs uppercase tracking-wide text-ink-500">
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Attempts</th>
                    <th className="pb-2">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-base-700">
                  {jobs!.data.map((j) => (
                    <tr key={j.id} className="hover:bg-base-800">
                      <td className="py-2">
                        <Link href={`/jobs/${j.id}`} className="font-mono text-ink-100 hover:text-status-queued">
                          {j.job_type}
                        </Link>
                      </td>
                      <td className="py-2">
                        <StatusBadge status={j.status} />
                      </td>
                      <td className="py-2 font-mono text-ink-500">{j.attempt_count}</td>
                      <td className="py-2 text-ink-500">{new Date(j.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <Panel title="Retry policy">
          {queue.retryPolicy ? (
            <dl className="space-y-2 text-sm">
              <Row label="Strategy" value={queue.retryPolicy.strategy} />
              <Row label="Base delay" value={`${queue.retryPolicy.base_delay_ms}ms`} />
              <Row label="Max delay" value={`${queue.retryPolicy.max_delay_ms}ms`} />
              <Row label="Max attempts" value={String(queue.retryPolicy.max_attempts)} />
              <Row label="Jitter" value={queue.retryPolicy.use_jitter ? "enabled" : "disabled"} />
            </dl>
          ) : (
            <p className="text-sm text-ink-700">No retry policy configured.</p>
          )}
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
