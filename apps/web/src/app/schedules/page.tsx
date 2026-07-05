"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { AppShell } from "@/components/AppShell";
import { PageHeader, Panel, EmptyState } from "@/components/ui";
import { CalendarClock } from "lucide-react";
import { api, ApiError } from "@/lib/api";

interface Schedule {
  id: string;
  name: string;
  cron_expression: string;
  is_active: boolean;
  next_run_at: string;
  last_run_at: string | null;
}

interface Queue {
  id: string;
  name: string;
}

export default function SchedulesPage() {
  const { data, mutate } = useSWR("schedules", () => api.get<{ data: Schedule[] }>("/api/schedules"), { refreshInterval: 8000 });
  const { data: queuesRes } = useSWR("queues-for-schedules", () => api.get<{ data: Queue[] }>("/api/queues"));
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createSchedule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await api.post("/api/schedules", {
        queueId: String(form.get("queueId")),
        name: String(form.get("name")),
        cronExpression: String(form.get("cronExpression")),
        payload: {},
      });
      setShowForm(false);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create schedule");
    }
  }

  async function toggle(schedule: Schedule) {
    await api.post(`/api/schedules/${schedule.id}/${schedule.is_active ? "pause" : "resume"}`);
    mutate();
  }

  return (
    <AppShell>
      <PageHeader
        title="Schedules"
        description="Recurring, cron-driven jobs. Each firing spawns a normal job on its target queue."
        action={
          <button onClick={() => setShowForm((s) => !s)} className="rounded-sm bg-status-queued px-3 py-1.5 text-sm font-medium text-base-950 hover:opacity-90">
            New schedule
          </button>
        }
      />

      {showForm && (
        <div className="mb-4">
          <Panel title="Create schedule">
            <form onSubmit={createSchedule} className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-500">Queue</span>
                <select name="queueId" required className="w-full rounded-sm border border-base-600 bg-base-800 px-3 py-2 text-sm text-ink-100 outline-none focus:border-status-queued">
                  {(queuesRes?.data ?? []).map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-500">Name</span>
                <input name="name" required className="w-full rounded-sm border border-base-600 bg-base-800 px-3 py-2 text-sm text-ink-100 outline-none focus:border-status-queued" />
              </label>
              <label className="block">
                <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-500">Cron expression</span>
                <input name="cronExpression" required placeholder="*/5 * * * *" className="w-full rounded-sm border border-base-600 bg-base-800 px-3 py-2 font-mono text-sm text-ink-100 outline-none focus:border-status-queued" />
              </label>
              {error && <p className="col-span-3 text-sm text-status-failed">{error}</p>}
              <button type="submit" className="col-span-3 rounded-sm bg-status-queued py-2 text-sm font-medium text-base-950 hover:opacity-90">
                Create
              </button>
            </form>
          </Panel>
        </div>
      )}

      <Panel>
        {(data?.data ?? []).length === 0 ? (
          <EmptyState title="No schedules yet" description="Create a cron schedule to have jobs fire automatically on a recurring cadence." icon={CalendarClock} />
        ) : (
          <div className="divide-y divide-base-700">
            {data!.data.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${s.is_active ? "bg-status-completed" : "bg-ink-700"}`} />
                    <span className="font-mono text-sm text-ink-100">{s.name}</span>
                    <span className="rounded-sm border border-base-600 px-1.5 py-0.5 font-mono text-2xs text-ink-500">{s.cron_expression}</span>
                  </div>
                  <p className="mt-1 text-2xs text-ink-700">next run {new Date(s.next_run_at).toLocaleString()}</p>
                </div>
                <button onClick={() => toggle(s)} className="text-2xs uppercase tracking-wide text-ink-500 hover:text-ink-100">
                  {s.is_active ? "pause" : "resume"}
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
