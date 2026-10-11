import { PibxTimeoutError } from './errors.js'

export interface Clock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export type Attempt<T> =
  | { done: true; value: T }
  | { done: false; lastStatus?: number; lastError?: string; retryAfterMs?: number }

/**
 * Always makes at least one attempt, so `timeoutMs: 0` means "check once".
 * Never sleeps past the deadline: the final sleep is shortened to what remains.
 * Each attempt is told how much time is left so it can bound its own request.
 */
export async function poll<T>(
  attempt: (remainingMs: number) => Promise<Attempt<T>>,
  opts: { timeoutMs: number; intervalMs: number; describe: string; clock?: Clock },
): Promise<T> {
  const clock = opts.clock ?? realClock
  const deadline = clock.now() + opts.timeoutMs

  for (;;) {
    const result = await attempt(Math.max(deadline - clock.now(), 0))
    if (result.done) return result.value

    const remaining = deadline - clock.now()
    if (remaining <= 0) {
      const detail =
        result.lastStatus !== undefined
          ? ` (last status ${result.lastStatus})`
          : result.lastError !== undefined
            ? ` (last error: ${result.lastError})`
            : ''
      throw new PibxTimeoutError(
        `Timed out after ${opts.timeoutMs}ms waiting for ${opts.describe}${detail}`,
        result.lastStatus,
      )
    }
    const wanted = Math.max(opts.intervalMs, result.retryAfterMs ?? 0)
    await clock.sleep(Math.min(wanted, remaining))
  }
}
