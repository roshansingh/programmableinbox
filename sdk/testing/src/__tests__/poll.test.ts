import { describe, it, expect } from 'vitest'
import { poll, type Clock } from '../poll.js'
import { PibxTimeoutError } from '../errors.js'

function fakeClock(): Clock & { slept: number[] } {
  let t = 0
  const slept: number[] = []
  return {
    slept,
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms)
      t += ms
    },
  }
}

describe('poll', () => {
  it('returns the value as soon as an attempt is done', async () => {
    const clock = fakeClock()
    let n = 0
    const value = await poll(
      async () => (++n < 3 ? { done: false as const } : { done: true as const, value: 'ok' }),
      { timeoutMs: 60_000, intervalMs: 2_000, describe: 'code', clock },
    )
    expect(value).toBe('ok')
    expect(n).toBe(3)
    expect(clock.slept).toEqual([2_000, 2_000])
  })

  it('makes exactly one attempt when timeoutMs is 0', async () => {
    const clock = fakeClock()
    let n = 0
    await expect(
      poll(async () => (n++, { done: false as const, lastStatus: 404 }), {
        timeoutMs: 0,
        intervalMs: 2_000,
        describe: 'code',
        clock,
      }),
    ).rejects.toBeInstanceOf(PibxTimeoutError)
    expect(n).toBe(1)
  })

  it('never sleeps past the deadline and reports the last status', async () => {
    const clock = fakeClock()
    const err = await poll(async () => ({ done: false as const, lastStatus: 404 }), {
      timeoutMs: 5_000,
      intervalMs: 2_000,
      describe: 'a code',
      clock,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(PibxTimeoutError)
    expect(err.lastStatus).toBe(404)
    expect(err.message).toContain('a code')
    expect(clock.slept).toEqual([2_000, 2_000, 1_000])
  })

  it('honours retryAfterMs but is still capped by the deadline', async () => {
    const clock = fakeClock()
    await poll(async () => ({ done: false as const, lastStatus: 429, retryAfterMs: 30_000 }), {
      timeoutMs: 10_000,
      intervalMs: 2_000,
      describe: 'code',
      clock,
    }).catch(() => undefined)
    expect(clock.slept).toEqual([10_000])
  })

  it('passes the remaining time to each attempt', async () => {
    const clock = fakeClock()
    const seen: number[] = []
    await poll(
      async (remaining) => {
        seen.push(remaining)
        return { done: false as const }
      },
      { timeoutMs: 5_000, intervalMs: 2_000, describe: 'code', clock },
    ).catch(() => undefined)
    // The last sleep lands exactly on the deadline, then one final check runs
    // with nothing left, so a code arriving in the final interval is not missed.
    expect(seen).toEqual([5_000, 3_000, 1_000, 0])
  })

  it('includes the last server message beside the status', async () => {
    const clock = fakeClock()
    const err = await poll(
      async () => ({ done: false as const, lastStatus: 404, lastMessage: 'No message with a one-time code' }),
      { timeoutMs: 0, intervalMs: 1, describe: 'a code', clock },
    ).catch((e) => e)
    expect(err.message).toContain('last status 404: No message with a one-time code')
  })

  it('reports lastError in the timeout message when there is no status', async () => {
    const clock = fakeClock()
    const err = await poll(async () => ({ done: false as const, lastError: 'fetch failed' }), {
      timeoutMs: 0,
      intervalMs: 1,
      describe: 'a code',
      clock,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(PibxTimeoutError)
    expect(err.lastStatus).toBeUndefined()
    expect(err.message).toContain('last error: fetch failed')
  })
})
