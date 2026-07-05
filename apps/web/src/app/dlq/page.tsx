"use client";

import useSWR from "swr";
import { AppShell } from "@/components/AppShell";
import { PageHeader, Panel, EmptyState } from "@/components/ui";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import Link from "next/link";

interface DlqEntry {
  id: string;
  job_id: string;
  final_error: string;
  moved_at: string;
  requeued: boolean;
  job_type: string;
  attempt_count: number;
  queueName: string;
}

export default function DlqPage() {
  const { data, mutate } = useSWR("dlq", () => api.get<{ data: DlqEntry[] }>("/api/dlq"), { refreshInterval: 5000 });
  const entries = (data?.data ?? []).filter((e) => !e.requeued);

  async function requeue(entryId: string) {
    await api.post(`/api/dlq/${entryId}/requeue`);
    mutate();
  }

  return (
    <AppShell>
      <PageHeader title="Dead letter queue" description="Jobs that exhausted every retry attempt. Inspect the error, then requeue if the underlying issue is fixed." />

      <Panel>
        {entries.length === 0 ? (
          <EmptyState title="Nothing here" description="Jobs land here only after exhausting their queue's max attempts." icon={ShieldCheck} />
        ) : (
          <div className="divide-y divide-base-700">
            {entries.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-4 py-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/jobs/${e.job_id}`} className="font-mono text-sm text-ink-100 hover:text-status-queued">
                      {e.job_type}
                    </Link>
                    <span className="text-2xs text-ink-700">in {e.queueName}</span>
                    <span className="text-2xs text-ink-700">· {e.attempt_count} attempts</span>
                  </div>
                  <p className="mt-1 text-sm text-status-failed">{e.final_error}</p>
                  <p className="mt-1 text-2xs text-ink-700">moved {new Date(e.moved_at).toLocaleString()}</p>
                </div>
                <button
                  onClick={() => requeue(e.id)}
                  className="shrink-0 rounded-sm border border-base-600 px-3 py-1.5 text-2xs uppercase tracking-wide text-ink-300 hover:border-status-queued hover:text-status-queued"
                >
                  Requeue
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
