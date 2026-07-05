import { describe, it, expect } from "vitest";
import { computeNextRun, isValidCronExpression } from "./cron";

describe("cron helpers", () => {
  it("computes the next run for an every-5-minutes expression", () => {
    const from = new Date("2026-07-04T10:02:00Z");
    const next = computeNextRun("*/5 * * * *", from);
    expect(next.toISOString()).toBe("2026-07-04T10:05:00.000Z");
  });

  it("computes the next run for a daily-at-midnight expression", () => {
    const from = new Date("2026-07-04T15:30:00Z");
    const next = computeNextRun("0 0 * * *", from);
    expect(next.toISOString()).toBe("2026-07-05T00:00:00.000Z");
  });

  it("throws a clear error on an invalid expression", () => {
    expect(() => computeNextRun("not a cron")).toThrow(/Invalid cron expression/);
  });

  it("validates expressions without throwing", () => {
    expect(isValidCronExpression("*/5 * * * *")).toBe(true);
    expect(isValidCronExpression("garbage")).toBe(false);
  });
});
