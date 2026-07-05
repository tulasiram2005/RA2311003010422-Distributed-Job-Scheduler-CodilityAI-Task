import { describe, it, expect } from "vitest";
import { isValidTransition, assertValidTransition, InvalidTransitionError, isTerminal } from "./jobLifecycle";

describe("job lifecycle state machine", () => {
  it("allows the standard immediate-job happy path", () => {
    expect(isValidTransition("QUEUED", "CLAIMED")).toBe(true);
    expect(isValidTransition("CLAIMED", "RUNNING")).toBe(true);
    expect(isValidTransition("RUNNING", "COMPLETED")).toBe(true);
  });

  it("allows the scheduled-job path through SCHEDULED first", () => {
    expect(isValidTransition("SCHEDULED", "QUEUED")).toBe(true);
  });

  it("allows failure to route into retry or dead-letter", () => {
    expect(isValidTransition("FAILED", "RETRYING")).toBe(true);
    expect(isValidTransition("FAILED", "DEAD")).toBe(true);
    expect(isValidTransition("RETRYING", "QUEUED")).toBe(true);
  });

  it("allows a claimed/running job to be reclaimed back to QUEUED (abandoned lease)", () => {
    expect(isValidTransition("CLAIMED", "QUEUED")).toBe(true);
    expect(isValidTransition("RUNNING", "QUEUED")).toBe(true);
  });

  it("rejects skipping straight from QUEUED to COMPLETED", () => {
    expect(isValidTransition("QUEUED", "COMPLETED")).toBe(false);
  });

  it("rejects any transition out of a terminal state", () => {
    expect(isValidTransition("COMPLETED", "QUEUED")).toBe(false);
    expect(isValidTransition("DEAD", "QUEUED")).toBe(false);
    expect(isValidTransition("CANCELLED", "RUNNING")).toBe(false);
  });

  it("throws a typed error via assertValidTransition on an illegal move", () => {
    expect(() => assertValidTransition("COMPLETED", "RUNNING")).toThrow(InvalidTransitionError);
  });

  it("correctly identifies terminal states", () => {
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(isTerminal("DEAD")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("RUNNING")).toBe(false);
  });
});
