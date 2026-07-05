export interface JobContext {
  jobId: string;
  attempt: number;
  payload: unknown;
  log: (message: string) => void;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;

// This is the seam where real business logic goes. Ship your own handler
// map in a real deployment — these three are demo/reference handlers so the
// dashboard has something believable to show, plus one deliberately-flaky
// handler for exercising the retry → DLQ path end to end.
const handlers: Record<string, JobHandler> = {
  send_email: async (ctx) => {
    ctx.log(`sending email with payload ${JSON.stringify(ctx.payload)}`);
    await sleep(150 + Math.random() * 250);
  },

  generate_report: async (ctx) => {
    ctx.log("compiling report sections");
    await sleep(400 + Math.random() * 600);
    ctx.log("report generated");
  },

  sync_order: async (ctx) => {
    ctx.log(`syncing order ${JSON.stringify(ctx.payload)}`);
    await sleep(100 + Math.random() * 200);
  },

  // Fails on the first two attempts, succeeds on the third — good for
  // manually verifying the whole retry → backoff → success arc.
  flaky_demo: async (ctx) => {
    ctx.log(`flaky_demo attempt ${ctx.attempt}`);
    await sleep(100);
    if (ctx.attempt < 3) {
      throw new Error(`simulated transient failure on attempt ${ctx.attempt}`);
    }
  },

  // Always fails — for verifying the DLQ path without waiting out real
  // backoff timers.
  always_fails: async () => {
    throw new Error("simulated permanent failure");
  },
};

export function getHandler(jobType: string): JobHandler {
  return handlers[jobType] ?? handlers.default ?? genericFallback;
}

const genericFallback: JobHandler = async (ctx) => {
  ctx.log(`no handler registered for this job type — treating as a no-op success`);
  await sleep(50);
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
