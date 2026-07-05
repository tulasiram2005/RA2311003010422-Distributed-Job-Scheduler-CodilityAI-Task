"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Activity, Cpu, Layers, ShieldCheck, Zap } from "lucide-react";

const FEATURES = [
  { icon: Layers, text: "Priority queues with per-queue concurrency limits" },
  { icon: Zap, text: "Automatic retries with exponential backoff" },
  { icon: Cpu, text: "Live worker fleet health & heartbeats" },
  { icon: ShieldCheck, text: "Dead-letter queue for jobs that exhaust retries" },
];

export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    try {
      if (mode === "login") {
        await login(String(form.get("email")), String(form.get("password")));
      } else {
        await register(
          String(form.get("name")),
          String(form.get("email")),
          String(form.get("password")),
          String(form.get("organizationName"))
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-base-950">
      {/* ambient glow — decorative only, respects prefers-reduced-motion via global rule */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-status-queued/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10rem] right-[-8rem] h-[28rem] w-[28rem] rounded-full bg-status-completed/10 blur-3xl" />

      {/* Left: brand + feature panel (hidden on small screens) */}
      <div className="relative hidden w-1/2 flex-col justify-between border-r border-base-700 px-12 py-10 lg:flex">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-completed opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-status-completed" />
            </span>
            <span className="font-mono text-sm font-medium text-ink-100">scheduler</span>
          </div>

          <h1 className="mt-16 max-w-md text-3xl font-medium leading-tight text-ink-100">
            Distributed job scheduling,{" "}
            <span className="bg-gradient-to-r from-status-queued to-status-completed bg-clip-text text-transparent">
              built for reliability.
            </span>
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-500">
            Submit, schedule, and monitor jobs across a fleet of workers — with the visibility to trust what&apos;s running
            and the guardrails to recover when it doesn&apos;t.
          </p>

          <ul className="mt-10 space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-ink-300">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-base-700 bg-base-900">
                  <Icon size={14} strokeWidth={1.75} className="text-status-queued" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2 font-mono text-2xs text-ink-700">
          <Activity size={13} strokeWidth={1.75} />
          live throughput, p95 latency, and failure rate on every dashboard
        </div>
      </div>

      {/* Right: auth form */}
      <div className="relative flex w-full flex-1 items-center justify-center px-4 py-10 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="h-2 w-2 rounded-full bg-status-completed" />
            <span className="font-mono text-sm text-ink-100">scheduler</span>
          </div>

          <div className="rounded-md border border-base-700 bg-base-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur-sm">
            <h1 className="mb-1 text-lg font-medium text-ink-100">
              {mode === "login" ? "Sign in" : "Create your account"}
            </h1>
            <p className="mb-6 text-sm text-ink-500">
              {mode === "login" ? "Access your queues and job history." : "Sets up a new organization and project workspace."}
            </p>

            <form onSubmit={onSubmit} className="space-y-3">
              {mode === "register" && (
                <>
                  <Field name="name" label="Your name" type="text" required />
                  <Field name="organizationName" label="Organization name" type="text" required />
                </>
              )}
              <Field name="email" label="Email" type="email" required />
              <Field name="password" label="Password" type="password" required minLength={8} />

              {error && (
                <div className="rounded-sm border border-status-failed/30 bg-status-failed/10 px-3 py-2 text-sm text-status-failed">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-sm bg-status-queued py-2 text-sm font-medium text-base-950 transition-all hover:opacity-90 hover:shadow-lg hover:shadow-status-queued/20 disabled:opacity-50"
              >
                {submitting ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>
          </div>

          <button
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="mt-4 w-full text-center text-sm text-ink-500 hover:text-ink-300"
          >
            {mode === "login" ? "Need a workspace? Create one" : "Already have an account? Sign in"}
          </button>

          {mode === "login" && (
            <p className="mt-6 text-center font-mono text-2xs text-ink-700">demo@acme.dev / password123</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ name, label, type, required, minLength }: { name: string; label: string; type: string; required?: boolean; minLength?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-500">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        minLength={minLength}
        className="w-full rounded-sm border border-base-600 bg-base-800 px-3 py-2 text-sm text-ink-100 outline-none transition-colors focus:border-status-queued"
      />
    </label>
  );
}
