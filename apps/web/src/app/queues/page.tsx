"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader, Panel, EmptyState } from "@/components/ui";
import { ListTree } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useProjects } from "@/lib/useProjects";

interface Queue {
  id: string;
  name: string;
  description: string | null;
  is_paused: boolean;
  concurrency_limit: number;
  default_priority: number;
}

export default function QueuesPage() {
  const { projects } = useProjects();
  const { data, mutate } = useSWR("queues", () => api.get<{ data: Queue[] }>("/api/queues"), { refreshInterval: 8000 });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createQueue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await api.post("/api/queues", {
        projectId: projects[0]?.id,
        name: String(form.get("name")),
        description: String(form.get("description") || "") || undefined,
        concurrencyLimit: Number(form.get("concurrencyLimit")),
        defaultPriority: Number(form.get("defaultPriority")),
      });
      setShowForm(false);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create queue");
    }
  }

  async function togglePause(queue: Queue) {
    await api.post(`/api/queues/${queue.id}/${queue.is_paused ? "resume" : "pause"}`);
    mutate();
  }

  return (
    <AppShell>
      <PageHeader
        title="Queues"
        description="Each queue holds its own concurrency limit, priority, and retry policy."
        action={
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-sm bg-status-queued px-3 py-1.5 text-sm font-medium text-base-950 hover:opacity-90"
          >
            New queue
          </button>
        }
      />

      {showForm && (
        <Panel title="Create queue">
          <form onSubmit={createQueue} className="grid grid-cols-2 gap-3">
            <label className="col-span-2 block">
              <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-500">Name</span>
              <input name="name" required className="w-full rounded-sm border border-base-600 bg-base-800 px-3 py-2 text-sm text-ink-100 outline-none focus:border-status-queued" />
            </label>
            <label className="col-span-2 block">
              <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-500">Description (optional)</span>
              <input name="description" className="w-full rounded-sm border border-base-600 bg-base-800 px-3 py-2 text-sm text-ink-100 outline-none focus:border-status-queued" />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-500">Concurrency limit</span>
              <input name="concurrencyLimit" type="number" defaultValue={5} min={1} className="w-full rounded-sm border border-base-600 bg-base-800 px-3 py-2 text-sm text-ink-100 outline-none focus:border-status-queued" />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-500">Default priority</span>
              <input name="defaultPriority" type="number" defaultValue={0} min={0} className="w-full rounded-sm border border-base-600 bg-base-800 px-3 py-2 text-sm text-ink-100 outline-none focus:border-status-queued" />
            </label>
            {error && <p className="col-span-2 text-sm text-status-failed">{error}</p>}
            <button type="submit" className="col-span-2 rounded-sm bg-status-queued py-2 text-sm font-medium text-base-950 hover:opacity-90">
              Create
            </button>
          </form>
        </Panel>
      )}

      <div className="mt-4">
        {(data?.data ?? []).length === 0 ? (
          <EmptyState title="No queues yet" description="Create your first queue to start submitting jobs to it." icon={ListTree} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {data!.data.map((q) => (
              <div key={q.id} className="rounded-md border border-base-700 bg-base-900 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <Link href={`/queues/${q.id}`} className="font-mono text-sm text-ink-100 hover:text-status-queued">
                    {q.name}
                  </Link>
                  <span className={`h-1.5 w-1.5 rounded-full ${q.is_paused ? "bg-ink-700" : "bg-status-completed"}`} />
                </div>
                {q.description && <p className="mb-3 text-sm text-ink-500">{q.description}</p>}
                <div className="mb-3 flex gap-4 text-2xs text-ink-500">
                  <span>concurrency {q.concurrency_limit}</span>
                  <span>priority {q.default_priority}</span>
                </div>
                <button
                  onClick={() => togglePause(q)}
                  className="text-2xs uppercase tracking-wide text-ink-500 hover:text-ink-100"
                >
                  {q.is_paused ? "resume queue" : "pause queue"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
