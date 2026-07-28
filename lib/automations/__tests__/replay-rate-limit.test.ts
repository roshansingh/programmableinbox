/**
 * Unit tests for the automation-replay rate limiter (security issue #40).
 *
 * A fake Redis client is injected via `setReplayRateLimitClient`, so no socket
 * is ever opened and the fixed-window arithmetic is asserted directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REPLAY_RATE_LIMITS,
  consumeReplayRateLimit,
  setReplayRateLimitClient,
  type ReplayRateLimitClient,
} from '../replay-rate-limit'

function createFakeRedis() {
  const counters = new Map<string, number>()
  const expires: Array<{ key: string; seconds: number }> = []
  const client: ReplayRateLimitClient & { counters: typeof counters; expires: typeof expires } = {
    counters,
    expires,
    async incr(key: string) {
      const next = (counters.get(key) ?? 0) + 1
      counters.set(key, next)
      return next
    },
    async expire(key: string, seconds: number) {
      expires.push({ key, seconds })
      return 1
    },
  }
  return client
}

const T0 = 1_700_000_000_000

beforeEach(() => {
  setReplayRateLimitClient(createFakeRedis())
})

afterEach(() => {
  setReplayRateLimitClient(null)
})

describe('consumeReplayRateLimit', () => {
  it('allows calls up to the live per-user budget and denies the next one', async () => {
    const limit = REPLAY_RATE_LIMITS.live.user.limit
    const params = { userId: 'user_1', automationId: 'automation_1', mode: 'live' as const, now: T0 }

    for (let i = 0; i < limit; i += 1) {
      expect(await consumeReplayRateLimit(params)).toEqual({ allowed: true })
    }

    const denied = await consumeReplayRateLimit(params)
    expect(denied.allowed).toBe(false)
    expect(denied).toMatchObject({ reason: 'limit_exceeded', scope: 'user', limit })
  })

  it('denies on the per-automation budget when many users share one automation', async () => {
    const automationLimit = REPLAY_RATE_LIMITS.live.automation.limit
    // Each caller is a distinct user, so the per-user budget is never the
    // binding constraint — only the shared automation budget is.
    for (let i = 0; i < automationLimit; i += 1) {
      const decision = await consumeReplayRateLimit({
        userId: `user_${i}`,
        automationId: 'automation_1',
        mode: 'live',
        now: T0,
      })
      expect(decision).toEqual({ allowed: true })
    }

    const denied = await consumeReplayRateLimit({
      userId: 'user_last',
      automationId: 'automation_1',
      mode: 'live',
      now: T0,
    })
    expect(denied).toMatchObject({ reason: 'limit_exceeded', scope: 'automation' })
  })

  it('keeps dry-run and live budgets independent', async () => {
    const liveLimit = REPLAY_RATE_LIMITS.live.user.limit
    for (let i = 0; i <= liveLimit; i += 1) {
      await consumeReplayRateLimit({ userId: 'user_1', automationId: 'a1', mode: 'live', now: T0 })
    }

    // Live is exhausted; dry-run must still be allowed.
    expect(
      await consumeReplayRateLimit({ userId: 'user_1', automationId: 'a1', mode: 'dry_run', now: T0 })
    ).toEqual({ allowed: true })
  })

  it('resets in the next fixed window', async () => {
    const limit = REPLAY_RATE_LIMITS.live.user.limit
    const windowMs = REPLAY_RATE_LIMITS.live.user.windowSeconds * 1000
    for (let i = 0; i <= limit; i += 1) {
      await consumeReplayRateLimit({ userId: 'user_1', automationId: 'a1', mode: 'live', now: T0 })
    }

    expect(
      await consumeReplayRateLimit({
        userId: 'user_1',
        automationId: 'a1',
        mode: 'live',
        now: T0 + windowMs,
      })
    ).toEqual({ allowed: true })
  })

  it('reports a Retry-After bounded by the window length', async () => {
    const { limit, windowSeconds } = REPLAY_RATE_LIMITS.live.user
    const params = { userId: 'user_1', automationId: 'a1', mode: 'live' as const, now: T0 }
    for (let i = 0; i <= limit; i += 1) {
      await consumeReplayRateLimit(params)
    }
    const denied = await consumeReplayRateLimit(params)
    expect(denied.allowed).toBe(false)
    if (denied.allowed === false && denied.reason === 'limit_exceeded') {
      expect(denied.retryAfterSeconds).toBeGreaterThan(0)
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(windowSeconds)
    }
  })

  it('sets a TTL on every increment so a failed expire cannot leak a permanent counter', async () => {
    const fake = createFakeRedis()
    setReplayRateLimitClient(fake)

    await consumeReplayRateLimit({ userId: 'user_1', automationId: 'a1', mode: 'live', now: T0 })
    await consumeReplayRateLimit({ userId: 'user_1', automationId: 'a1', mode: 'live', now: T0 })

    // 2 calls x (user key + automation key)
    expect(fake.expires).toHaveLength(4)
    expect(fake.expires.every((e) => e.seconds === 60)).toBe(true)
  })

  it("reports 'unavailable' rather than throwing when Redis errors", async () => {
    setReplayRateLimitClient({
      incr: async () => {
        throw new Error('ECONNREFUSED')
      },
      expire: async () => 1,
    })

    expect(
      await consumeReplayRateLimit({ userId: 'user_1', automationId: 'a1', mode: 'live', now: T0 })
    ).toEqual({ allowed: false, reason: 'unavailable' })
  })

  it("reports 'unavailable' rather than hanging when Redis never responds", async () => {
    vi.useFakeTimers()
    setReplayRateLimitClient({
      incr: () => new Promise<number>(() => {}),
      expire: async () => 1,
    })

    const pending = consumeReplayRateLimit({
      userId: 'user_1',
      automationId: 'a1',
      mode: 'live',
      now: T0,
    })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await pending).toEqual({ allowed: false, reason: 'unavailable' })
    vi.useRealTimers()
  })

  it('scopes keys by mode, scope and identity', async () => {
    const fake = createFakeRedis()
    setReplayRateLimitClient(fake)

    await consumeReplayRateLimit({ userId: 'user_1', automationId: 'a1', mode: 'live', now: T0 })
    const keys = [...fake.counters.keys()]
    expect(keys.some((k) => k.startsWith('ratelimit:automation-replay:live:user:user_1:'))).toBe(true)
    expect(keys.some((k) => k.startsWith('ratelimit:automation-replay:live:automation:a1:'))).toBe(true)
  })
})
