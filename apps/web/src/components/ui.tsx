import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

export function Panel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="glass-card overflow-hidden rounded-xl">
      {title && (
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="text-sm font-medium text-ink-100">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function StatCard({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: string; tone?: string; icon?: LucideIcon }) {
  const Icon = icon;
  return (
    <div className="glass-card group rounded-xl p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.14] hover:shadow-lg hover:shadow-black/20">
      <div className="flex items-center justify-between">
        <div className="text-2xs uppercase tracking-wide text-ink-500">{label}</div>
        {Icon && <Icon size={14} strokeWidth={1.75} className="text-ink-700 transition-colors group-hover:text-status-queued" />}
      </div>
      <div className={`mt-1 font-mono text-2xl ${tone ?? "text-ink-100"}`}>{value}</div>
      {sub && <div className="mt-1 text-2xs text-ink-700">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, description, icon }: { title: string; description: string; icon?: LucideIcon }) {
  const Icon = icon ?? Inbox;
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-base-600 py-12 text-center">
      <Icon size={22} strokeWidth={1.5} className="mb-3 text-ink-700" />
      <p className="text-sm text-ink-300">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-700">{description}</p>
    </div>
  );
}

/** Skeleton rows for loading states — replaces plain "Loading…" text with something that reads as intentional rather than unfinished. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-sm bg-base-800" style={{ animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-md border border-base-700 bg-base-800" style={{ animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );
}
