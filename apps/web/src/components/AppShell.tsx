"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Sidebar } from "./Sidebar";
import { PulseRail, type PulseEvent } from "./PulseRail";

interface JobRow {
  id: string;
  status: string;
  updated_at: string;
}

function useRecentPulse(): PulseEvent[] {
  const { data } = useSWR(
    "pulse",
    async () => {
      const [completed, failed] = await Promise.all([
        api.get<{ data: JobRow[] }>("/api/jobs?status=COMPLETED&limit=15"),
        api.get<{ data: JobRow[] }>("/api/jobs?status=FAILED&limit=15"),
      ]);
      return [...completed.data, ...failed.data]
        .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
        .map((j) => ({ id: j.id, status: j.status as "COMPLETED" | "FAILED", at: new Date(j.updated_at).getTime() }));
    },
    { refreshInterval: 4000 }
  );
  return data ?? [];
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const pulse = useRecentPulse();

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !loading && !user) router.replace("/login");
  }, [mounted, loading, user, router]);

  if (!mounted || loading || !user) {
    return <div className="flex h-screen items-center justify-center bg-base-950 font-mono text-2xs text-ink-500">loading…</div>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <PulseRail events={pulse} />
        <main className="flex-1 overflow-y-auto bg-base-950 p-4 pt-14 md:p-6 md:pt-6">{children}</main>
      </div>
    </div>
  );
}
