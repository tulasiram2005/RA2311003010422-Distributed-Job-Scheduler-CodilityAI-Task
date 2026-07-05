"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Activity, ArrowRight, Check, Cpu, Layers, ShieldCheck, Sparkles, Zap } from "lucide-react";

const FEATURES = [
  { icon: Layers, text: "Priority queues with per-queue concurrency limits" },
  { icon: Zap, text: "Automatic retries with exponential backoff" },
  { icon: Cpu, text: "Live worker fleet health & heartbeats" },
  { icon: ShieldCheck, text: "Dead-letter queue for jobs that exhaust retries" },
];

export default function LoginPage() {
  const { login, register, enterDemo } = useAuth();
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
      <div className="grid-overlay pointer-events-none absolute inset-0 opacity-40" />
      {/* ambient glow — decorative only, respects prefers-reduced-motion via global rule */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-status-queued/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10rem] right-[-8rem] h-[28rem] w-[28rem] rounded-full bg-status-completed/10 blur-3xl" />

      {/* Left: brand + feature panel (hidden on small screens) */}
      <div className="relative hidden w-[55%] flex-col justify-between border-r border-white/[0.06] px-16 py-12 lg:flex">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-completed opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-status-completed" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-white">Orbit<span className="text-status-queued">Flow</span></span>
            <span className="ml-2 rounded-full border border-status-completed/20 bg-status-completed/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-status-completed">Live</span>
          </div>

          <div className="mt-20 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-ink-300">
            <Sparkles size={13} className="text-violet-400" /> Infrastructure that never sleeps
          </div>
          <h1 className="mt-6 max-w-xl text-5xl font-semibold leading-[1.05] tracking-[-0.04em] text-white">
            Every job. Right place.{" "}
            <span className="bg-gradient-to-r from-violet-400 via-status-queued to-cyan-300 bg-clip-text text-transparent">
              Right on time.
            </span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-ink-500">
            Submit, schedule, and monitor jobs across a fleet of workers — with the visibility to trust what&apos;s running
            and the guardrails to recover when it doesn&apos;t.
          </p>

          <ul className="mt-10 grid max-w-xl grid-cols-2 gap-3">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="glass-card flex items-start gap-3 rounded-xl p-3.5 text-xs leading-relaxed text-ink-300">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-status-queued/10">
                  <Icon size={14} strokeWidth={1.75} className="text-status-queued" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2 font-mono text-2xs text-ink-700">
          <Activity size={13} strokeWidth={1.75} />
          Built for resilient, observable distributed systems
        </div>
      </div>

      {/* Right: auth form */}
      <div className="relative flex w-full flex-1 items-center justify-center px-4 py-10 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="h-2 w-2 rounded-full bg-status-completed" />
            <span className="text-sm font-semibold text-white">Orbit<span className="text-status-queued">Flow</span></span>
          </div>

          <div className="glass-card rounded-2xl p-7 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 shadow-lg shadow-blue-500/20">
              <Zap size={20} className="fill-white text-white" />
            </div>
            <h1 className="mb-1 text-2xl font-semibold tracking-tight text-white">
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
                className="group flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 py-2.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-500/25 disabled:opacity-50"
              >
                {submitting ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
                {!submitting && <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />}
              </button>
            </form>

            {mode === "login" && (
              <>
                <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-ink-700">
                  <span className="h-px flex-1 bg-white/[0.07]" /> or <span className="h-px flex-1 bg-white/[0.07]" />
                </div>
                <button onClick={enterDemo} className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] py-2.5 text-sm font-medium text-ink-300 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white">
                  <Sparkles size={15} className="text-violet-400" /> Explore live demo
                </button>
              </>
            )}
          </div>

          <button
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="mt-4 w-full text-center text-sm text-ink-500 hover:text-ink-300"
          >
            {mode === "login" ? "Need a workspace? Create one" : "Already have an account? Sign in"}
          </button>

          <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-ink-700"><Check size={13} /> No credit card · Setup in seconds</p>
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
        className="w-full rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2.5 text-sm text-ink-100 outline-none transition-all placeholder:text-ink-700 focus:border-status-queued/70 focus:bg-white/[0.05] focus:ring-2 focus:ring-status-queued/10"
      />
    </label>
  );
}
