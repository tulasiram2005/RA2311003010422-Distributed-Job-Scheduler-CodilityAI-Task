"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader, Panel, EmptyState, SkeletonRows } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { useAllQueuesLiveUpdates } from "@/lib/liveUpdates";

const STATUSES = ["SCHEDULED", "QUEUED", "CLAIMED", "RUNNING", "COMPLETED", "FAILED", "RETRYING", "DEAD", "CANCELLED"];

interface JobRow {
  id: string;
  job_type: string;
  status: string;
  priority: number;
  attempt_count: number;
  created_at: string;
}

export default function JobsPage() {
  const [status, setStatus] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  const { data: queuesRes } = useSWR("queues-for-live", () => api.get<{ data: { id: string }[] }>("/api/queues"));
  useAllQueuesLiveUpdates((queuesRes?.data ?? []).map((q) => q.id));

  const key = `jobs-${status}-${cursor ?? "first"}`;
  const { data, isLoading } = useSWR(key, () => {
    const params = new URLSearchParams({ limit: "20" });
    if (status) params.set("status", status);
    if (cursor) params.set("cursor", cursor);
    return api.get<{ data: JobRow[]; nextCursor: string | null }>(`/api/jobs?${params.toString()}`);
  });

  function nextPage() {
    if (data?.nextCursor) {
      setHistory((h) => [...h, cursor ?? ""]);
      setCursor(data.nextCursor);
    }
  }

  function prevPage() {
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCursor(prev || null);
  }

  return (
    <AppShell>
      <PageHeader title="Jobs" description="Every job across every queue, filterable by status." />

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => {
            setStatus("");
            setCursor(null);
            setHistory([]);
          }}
          className={`rounded-sm px-3 py-1.5 text-2xs uppercase tracking-wide ${status === "" ? "bg-base-700 text-ink-100" : "text-ink-500 hover:bg-base-800"}`}
        >
          all
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatus(s);
              setCursor(null);
              setHistory([]);
            }}
            className={`rounded-sm px-3 py-1.5 text-2xs uppercase tracking-wide ${status === s ? "bg-base-700 text-ink-100" : "text-ink-500 hover:bg-base-800"}`}
          >
            {s.toLowerCase()}
          </button>
        ))}
      </div>

      <Panel>
        {isLoading ? (
          <SkeletonRows rows={6} />
        ) : (data?.data ?? []).length === 0 ? (
          <EmptyState title="No jobs match this filter" description="Try a different status, or submit a job from a queue's detail page." />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wide text-ink-500">
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Priority</th>
                  <th className="pb-2">Attempts</th>
                  <th className="pb-2">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-700">
                {data!.data.map((j) => (
                  <tr key={j.id} className="hover:bg-base-800">
                    <td className="py-2">
                      <Link href={`/jobs/${j.id}`} className="font-mono text-ink-100 hover:text-status-queued">
                        {j.job_type}
                      </Link>
                    </td>
                    <td className="py-2">
                      <StatusBadge status={j.status} />
                    </td>
                    <td className="py-2 font-mono text-ink-500">{j.priority}</td>
                    <td className="py-2 font-mono text-ink-500">{j.attempt_count}</td>
                    <td className="py-2 text-ink-500">{new Date(j.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex justify-between border-t border-base-700 pt-3">
              <button onClick={prevPage} disabled={history.length === 0} className="text-2xs uppercase tracking-wide text-ink-500 hover:text-ink-100 disabled:opacity-30">
                ← previous
              </button>
              <button onClick={nextPage} disabled={!data?.nextCursor} className="text-2xs uppercase tracking-wide text-ink-500 hover:text-ink-100 disabled:opacity-30">
                next →
              </button>
            </div>
          </>
        )}
      </Panel>
    </AppShell>
  );
}
