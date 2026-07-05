import { describe, it, expect } from "vitest";
import { computeRetryDelayMs, shouldMoveToDeadLetter, type RetryPolicyConfig } from "./retry";

const noJitter = (overrides: Partial<RetryPolicyConfig> = {}): RetryPolicyConfig => ({
  strategy: "FIXED",
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  useJitter: false,
  ...overrides,
});

describe("computeRetryDelayMs", () => {
  it("returns a constant delay for FIXED regardless of attempt number", () => {
    const policy = noJitter({ strategy: "FIXED", baseDelayMs: 2000 });
    expect(computeRetryDelayMs(1, policy)).toBe(2000);
    expect(computeRetryDelayMs(5, policy)).toBe(2000);
  });

  it("scales linearly with attempt number for LINEAR", () => {
    const policy = noJitter({ strategy: "LINEAR", baseDelayMs: 1000 });
    expect(computeRetryDelayMs(1, policy)).toBe(1000);
    expect(computeRetryDelayMs(2, policy)).toBe(2000);
    expect(computeRetryDelayMs(4, policy)).toBe(4000);
  });

  it("doubles per attempt for EXPONENTIAL", () => {
    const policy = noJitter({ strategy: "EXPONENTIAL", baseDelayMs: 1000 });
    expect(computeRetryDelayMs(1, policy)).toBe(1000);
    expect(computeRetryDelayMs(2, policy)).toBe(2000);
    expect(computeRetryDelayMs(3, policy)).toBe(4000);
    expect(computeRetryDelayMs(4, policy)).toBe(8000);
  });

  it("caps the delay at maxDelayMs", () => {
    const policy = noJitter({ strategy: "EXPONENTIAL", baseDelayMs: 1000, maxDelayMs: 5000 });
    expect(computeRetryDelayMs(10, policy)).toBe(5000);
  });

  it("applies jitter within [0, computed delay]", () => {
    const policy = noJitter({ strategy: "EXPONENTIAL", baseDelayMs: 1000, useJitter: true });
    for (let i = 0; i < 50; i++) {
      const delay = computeRetryDelayMs(3, policy);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(4000);
    }
  });

  it("rejects attempt numbers below 1", () => {
    expect(() => computeRetryDelayMs(0, noJitter())).toThrow(RangeError);
  });
});

describe("shouldMoveToDeadLetter", () => {
  it("is false while attempts remain", () => {
    expect(shouldMoveToDeadLetter(2, 5)).toBe(false);
  });

  it("is true once attempts reach the max", () => {
    expect(shouldMoveToDeadLetter(5, 5)).toBe(true);
    expect(shouldMoveToDeadLetter(6, 5)).toBe(true);
  });
});
