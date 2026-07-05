"use client";

import useSWR from "swr";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { AppShell } from "@/components/AppShell";
import { PageHeader, Panel, StatCard, EmptyState } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { useAllQueuesLiveUpdates } from "@/lib/liveUpdates";
import Link from "next/link";
import { Cpu, Layers, Activity, AlertTriangle, Gauge } from "lucide-react";

interface Overview {
  statusCounts: Record<string, number>;
  throughputSeries: { bucket: string; completed: number; failed: number }[];
  p95DurationMs: number | null;
  activeWorkers: number;
}

interface Queue {
  id: string;
  name: string;
  is_paused: boolean;
  concurrency_limit: number;
}

export default function OverviewPage() {
  const { data: overview } = useSWR("overview", () => api.get<Overview>("/api/metrics/overview"), { refreshInterval: 5000 });
  const { data: queuesRes } = useSWR("queues-overview", () => api.get<{ data: Queue[] }>("/api/queues"), { refreshInterval: 10000 });
  useAllQueuesLiveUpdates((queuesRes?.data ?? []).map((q) => q.id));

  const counts = overview?.statusCounts ?? {};
  const backlog = (counts.QUEUED ?? 0) + (counts.SCHEDULED ?? 0) + (counts.RETRYING ?? 0);
  const inFlight = (counts.CLAIMED ?? 0) + (counts.RUNNING ?? 0);
  const totalRecent = overview ? Object.values(overview.statusCounts).reduce((a, b) => a + b, 0) : 0;
  const failureRate = totalRecent > 0 ? (((counts.FAILED ?? 0) + (counts.DEAD ?? 0)) / totalRecent) * 100 : 0;

  const chartData = (overview?.throughputSeries ?? []).map((p) => ({
    time: new Date(p.bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    completed: p.completed,
    failed: p.failed,
  }));

  return (
    <AppShell>
      <PageHeader title="Fleet overview" description="Live status across every queue in this organization." />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Active workers" value={overview?.activeWorkers ?? "—"} icon={Cpu} />
        <StatCard label="Backlog" value={backlog} sub="queued + scheduled + retrying" icon={Layers} />
        <StatCard label="In flight" value={inFlight} tone="text-status-running" icon={Activity} />
        <StatCard label="Failure rate" value={`${failureRate.toFixed(1)}%`} tone={failureRate > 5 ? "text-status-failed" : undefined} icon={AlertTriangle} />
        <StatCard label="p95 duration" value={overview?.p95DurationMs ? `${overview.p95DurationMs}ms` : "—"} icon={Gauge} />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Throughput — last 60 minutes">
            {chartData.length === 0 ? (
              <EmptyState title="No executions yet" description="Once jobs start running, completions and failures will chart here per minute." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="completed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3FBF7F" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#3FBF7F" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="failed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#E8544F" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#E8544F" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1D242D" vertical={false} />
                  <XAxis dataKey="time" stroke="#4B5563" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#4B5563" fontSize={11} tickLine={false} axisLine={false} width={28} />
                  <Tooltip contentStyle={{ background: "#151B22", border: "1px solid #2A333F", borderRadius: 6, fontSize: 12 }} />
                  <Area type="monotone" dataKey="completed" stroke="#3FBF7F" fill="url(#completed)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="failed" stroke="#E8544F" fill="url(#failed)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </div>

        <Panel title="Job status">
          <div className="space-y-2">
            {Object.entries(counts).length === 0 && <p className="text-sm text-ink-700">No jobs yet.</p>}
            {Object.entries(counts)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <StatusBadge status={status} />
                  <span className="font-mono text-sm text-ink-300">{count}</span>
                </div>
              ))}
          </div>
        </Panel>
      </div>

      <Panel
        title="Queues"
        action={
          <Link href="/queues" className="text-2xs uppercase tracking-wide text-status-queued hover:underline">
            view all →
          </Link>
        }
      >
        {(queuesRes?.data ?? []).length === 0 ? (
          <EmptyState title="No queues yet" description="Create a queue to start submitting jobs." />
        ) : (
          <div className="divide-y divide-base-700">
            {queuesRes!.data.slice(0, 6).map((q) => (
              <Link key={q.id} href={`/queues/${q.id}`} className="flex items-center justify-between py-2.5 hover:bg-base-800">
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${q.is_paused ? "bg-ink-700" : "bg-status-completed"}`} />
                  <span className="font-mono text-sm text-ink-100">{q.name}</span>
                </div>
                <span className="text-2xs text-ink-500">concurrency {q.concurrency_limit}</span>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
