/** One elapsed budget for the existing weekly draft request, not a retry or
 * execution service. Each awaited stage expires independently: late preflight
 * completion cannot resume the workflow and start a write after its deadline. */
export class WeeklyDraftDeadlineExpired extends Error {}
export function createWeeklyDraftDeadline(milliseconds: number, current: () => boolean = () => true) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 15_000) throw new Error("invalid_weekly_deadline");
  const expires = performance.now() + milliseconds;
  const check = () => {
    if (!current() || performance.now() >= expires) throw new WeeklyDraftDeadlineExpired();
  };
  return async <T>(start: () => PromiseLike<T>): Promise<T> => {
    check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => { check(); return start(); }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new WeeklyDraftDeadlineExpired()), Math.max(0, expires - performance.now())); }),
      ]);
      check();
      return value;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
}
