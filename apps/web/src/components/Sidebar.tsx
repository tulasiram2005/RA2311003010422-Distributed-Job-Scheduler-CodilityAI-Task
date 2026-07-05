"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  ListTree,
  ListChecks,
  CalendarClock,
  Cpu,
  Skull,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/queues", label: "Queues", icon: ListTree },
  { href: "/jobs", label: "Jobs", icon: ListChecks },
  { href: "/schedules", label: "Schedules", icon: CalendarClock },
  { href: "/workers", label: "Workers", icon: Cpu },
  { href: "/dlq", label: "Dead letter", icon: Skull },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-completed opacity-50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-status-completed" />
        </span>
        <span className="text-sm font-semibold tracking-tight text-white">Orbit<span className="text-status-queued">Flow</span></span>
      </div>

      <nav className="flex-1 px-3 py-5">
        <p className="mb-3 px-3 text-[10px] font-medium uppercase tracking-[0.18em] text-ink-700">Workspace</p>
        {NAV.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
                active ? "border border-status-queued/15 bg-status-queued/10 text-white shadow-sm" : "border border-transparent text-ink-500 hover:bg-white/[0.035] hover:text-ink-300"
              }`}
            >
              <Icon size={15} strokeWidth={1.75} className={active ? "text-status-queued" : ""} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="border-t border-white/[0.06] px-4 py-4">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 text-xs font-semibold text-white">{user.name?.[0] ?? "U"}</span>
            <div className="min-w-0"><div className="truncate text-xs font-medium text-ink-300">{user.name}</div><div className="truncate text-[10px] text-ink-700">{user.email}</div></div>
          </div>
          <button onClick={logout} className="text-2xs uppercase tracking-wide text-ink-700 hover:text-status-failed">
            sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop: always-visible fixed sidebar */}
      <aside className="hidden h-full w-60 shrink-0 border-r border-white/[0.06] bg-base-900/80 backdrop-blur-xl md:block">
        <SidebarContent />
      </aside>

      {/* Mobile: hamburger trigger, fixed to the corner of the viewport */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-30 rounded-sm border border-base-600 bg-base-900 p-2 text-ink-300 md:hidden"
        aria-label="Open navigation"
      >
        <Menu size={16} />
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-base-700 bg-base-900 shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 text-ink-500 hover:text-ink-100"
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
