import parser from "cron-parser";

export function computeNextRun(cronExpression: string, fromDate: Date = new Date()): Date {
  try {
    const interval = parser.parseExpression(cronExpression, { currentDate: fromDate });
    return interval.next().toDate();
  } catch (err) {
    throw new Error(`Invalid cron expression "${cronExpression}": ${(err as Error).message}`);
  }
}

export function isValidCronExpression(cronExpression: string): boolean {
  try {
    parser.parseExpression(cronExpression);
    return true;
  } catch {
    return false;
  }
}
