export type RetryStrategy = "FIXED" | "LINEAR" | "EXPONENTIAL";

export interface RetryPolicyConfig {
  strategy: RetryStrategy;
  baseDelayMs: number;
  maxDelayMs: number;
  useJitter: boolean;
}

/**
 * Computes how long to wait before the next attempt, given how many
 * attempts have already happened.
 *
 * attempt = 1 means "this was the first failure, about to try attempt 2".
 *
 * Jitter: when a burst of jobs fails at the same moment (a downstream
 * dependency blips), naive backoff means they all retry at the same
 * instant again — and again — which just re-creates the outage they're
 * recovering from. Full jitter (multiply by a random factor in [0, 1])
 * spreads the retries out instead of stacking them.
 */
export function computeRetryDelayMs(attempt: number, policy: RetryPolicyConfig): number {
  if (attempt < 1) throw new RangeError("attempt must be >= 1");

  let delay: number;
  switch (policy.strategy) {
    case "FIXED":
      delay = policy.baseDelayMs;
      break;
    case "LINEAR":
      delay = policy.baseDelayMs * attempt;
      break;
    case "EXPONENTIAL":
      delay = policy.baseDelayMs * Math.pow(2, attempt - 1);
      break;
    default: {
      const _exhaustive: never = policy.strategy;
      throw new Error(`Unknown retry strategy: ${_exhaustive}`);
    }
  }

  delay = Math.min(delay, policy.maxDelayMs);

  if (policy.useJitter) {
    // full jitter, not "equal jitter" — simpler, and AWS's own writeup on
    // backoff (Marc Brooker, 2015) found full jitter performs best under
    // contention despite the wider variance
    delay = Math.random() * delay;
  }

  return Math.round(delay);
}

export function shouldMoveToDeadLetter(attemptCount: number, maxAttempts: number): boolean {
  return attemptCount >= maxAttempts;
}
