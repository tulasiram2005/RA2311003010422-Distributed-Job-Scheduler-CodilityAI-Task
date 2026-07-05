"use client";

import useSWR from "swr";
import { AppShell } from "@/components/AppShell";
import { PageHeader, Panel, EmptyState } from "@/components/ui";
import { Cpu } from "lucide-react";
import { api } from "@/lib/api";

interface Worker {
  id: string;
  hostname: string;
  pid: number;
  status: string;
  last_heartbeat_at: string;
  current_load: number;
  isStale: boolean;
}

export default function WorkersPage() {
  const { data } = useSWR("workers", () => api.get<{ data: Worker[] }>("/api/workers"), { refreshInterval: 4000 });
  const workers = data?.data ?? [];

  return (
    <AppShell>
      <PageHeader title="Workers" description="Every worker process that has ever registered with this fleet." />

      <Panel>
        {workers.length === 0 ? (
          <EmptyState title="No workers registered" description="Start a worker process (npm run worker:dev) to see it appear here." icon={Cpu} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-500">
                <th className="pb-2">Host</th>
                <th className="pb-2">PID</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Load</th>
                <th className="pb-2">Last heartbeat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-base-700">
              {workers.map((w) => {
                const alive = w.status === "ALIVE" && !w.isStale;
                return (
                  <tr key={w.id} className="hover:bg-base-800">
                    <td className="py-2 font-mono text-ink-100">{w.hostname}</td>
                    <td className="py-2 font-mono text-ink-500">{w.pid}</td>
                    <td className="py-2">
                      <span className={`inline-flex items-center gap-1.5 text-2xs uppercase tracking-wide ${alive ? "text-status-completed" : "text-ink-700"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${alive ? "bg-status-completed" : "bg-ink-700"}`} />
                        {alive ? "alive" : w.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="py-2 font-mono text-ink-300">{w.current_load}</td>
                    <td className="py-2 text-ink-500">{new Date(w.last_heartbeat_at).toLocaleTimeString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </AppShell>
  );
}
