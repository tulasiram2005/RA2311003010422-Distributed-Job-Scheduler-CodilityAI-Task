"use client";

import { useEffect, useRef, useState } from "react";

export interface PulseEvent {
  id: string;
  status: "COMPLETED" | "FAILED";
  at: number;
}

const COLOR: Record<PulseEvent["status"], string> = {
  COMPLETED: "#3FBF7F",
  FAILED: "#E8544F",
};

/**
 * The one deliberately bold element on the page. Every job completion or
 * failure across the fleet ticks across this rail as a short colored bar —
 * a heartbeat monitor for throughput instead of a static number. Everything
 * else in the UI stays quiet so this is what actually gets noticed.
 */
export function PulseRail({ events }: { events: PulseEvent[] }) {
  const [ticks, setTicks] = useState<PulseEvent[]>([]);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const fresh = events.filter((e) => !seen.current.has(e.id));
    if (fresh.length === 0) return;
    fresh.forEach((e) => seen.current.add(e.id));
    // seen.current would otherwise grow forever over a long-running session
    // even though the visible ticks are capped — trim it back whenever it
    // gets meaningfully larger than what we could ever need to dedupe against.
    if (seen.current.size > 500) {
      seen.current = new Set(Array.from(seen.current).slice(-200));
    }
    setTicks((prev) => [...prev, ...fresh].slice(-60));
  }, [events]);

  return (
    <div className="relative h-10 w-full overflow-hidden border-b border-base-700 bg-base-900">
      <div className="absolute inset-0 flex items-end gap-[3px] px-3">
        {ticks.map((tick, i) => (
          <span
            key={tick.id}
            className="inline-block w-[3px] origin-bottom rounded-t-sm"
            style={{
              height: "70%",
              backgroundColor: COLOR[tick.status],
              opacity: 0.15 + (i / Math.max(ticks.length - 1, 1)) * 0.85,
            }}
          />
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-end pr-4">
        <span className="font-mono text-2xs text-ink-700">live</span>
      </div>
    </div>
  );
}
