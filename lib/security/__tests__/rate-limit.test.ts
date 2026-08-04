/**
 * Unit tests for lib/security/rate-limit.ts
 *
 * These drive the real limiter against an in-memory Redis fake (`FakeRedis`),
 * so the window arithmetic, lockout escalation and fail-open/closed branches
 * under test are the ones that run in production — only the storage is faked.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { withConfigEnv, setConfigEnv } from '@/test/config'
import { FakeRedis } from './fake-redis'
import {
  __resetLogThrottlesForTests,
  accountBucket,
  clearFailures,
  consumeClientIpRateLimit,
  consumeRateLimit,
  getClientIp,
  getLockoutState,
  getRateLimitConfig,
  ipBucket,
  lockoutDurationMs,
  lockoutHeaders,
  rateLimitBackendStatus,
  rateLimitHeaders,
  recordFailure,
  setRateLimitRedisClient,
} from '../rate-limit'

/** A fixed instant so window boundaries are deterministic. */
const T0 = 1_700_000_000_000

let redis: FakeRedis

function headersOf(request: Record<string, string>) {
  return { headers: new Headers(request) }
}

withConfigEnv({ AUTH_RATE_LIMIT_ENABLED: 'true' })

beforeEach(() => {
  redis = new FakeRedis(T0)
  setRateLimitRedisClient(redis)
  __resetLogThrottlesForTests()
  return () => setRateLimitRedisClient(null)
})

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

describe('accountBucket', () => {
  it('normalises case and surrounding whitespace to one bucket', () => {
    expect(accountBucket('  User@Example.COM ')).toBe(accountBucket('user@example.com'))
  })

  it('does not store the raw address', () => {
    const bucket = accountBucket('user@example.com')
    expect(bucket).not.toContain('user@example.com')
    expect(bucket).toMatch(/^[0-9a-f]{32}$/)
  })

  it('separates distinct addresses', () => {
    expect(accountBucket('a@example.com')).not.toBe(accountBucket('b@example.com'))
  })
})

describe('ipBucket', () => {
  it('buckets IPv6 addresses by /64 so a client cannot hop hosts', () => {
    const a = ipBucket('2001:0db8:85a3:0000:0000:8a2e:0370:7334')
    const b = ipBucket('2001:0db8:85a3:0000:1111:2222:3333:4444')
    expect(a).toBe(b)
    // Hextets are canonicalized (leading zeros stripped) so that the padded and
    // unpadded spellings of one prefix cannot be used as two separate buckets.
    expect(a).toBe('2001:db8:85a3:0::/64')
  })

  it('keeps distinct IPv6 /64s apart', () => {
    expect(ipBucket('2001:db8:1:2:0:0:0:1')).not.toBe(ipBucket('2001:db8:1:3:0:0:0:1'))
  })

  it('strips brackets and a trailing IPv4 port', () => {
    expect(ipBucket('203.0.113.9:44321')).toBe('203.0.113.9')
    expect(ipBucket('[2001:db8:1:2:3:4:5:6]')).toBe('2001:db8:1:2::/64')
  })

  it('falls back to `unknown` for an empty value', () => {
    expect(ipBucket('   ')).toBe('unknown')
  })
})

describe('IPv6 /64 bucketing (compressed addresses)', () => {
  it('buckets a compressed address by its /64, not its /128', () => {
    // The common real-world form. Bucketing these per-address handed an
    // attacker one bucket per interface identifier within a single /64.
    const a = ipBucket('2001:db8:1:2::1')
    const b = ipBucket('2001:db8:1:2::dead:beef')
    expect(a).toBe(b)
    expect(a).toBe('2001:db8:1:2::/64')
  })

  it('separates different /64s', () => {
    expect(ipBucket('2001:db8:1:2::1')).not.toBe(ipBucket('2001:db8:1:3::1'))
  })

  it('agrees between compressed and fully expanded spellings', () => {
    expect(ipBucket('2001:0db8:0001:0002:0000:0000:0000:0001')).toBe(ipBucket('2001:db8:1:2::1'))
  })

  it('handles brackets, ports, zero-compression at the start, and v4-mapped tails', () => {
    expect(ipBucket('[2001:db8:1:2::1]:8443')).toBe('2001:db8:1:2::/64')
    expect(ipBucket('::1')).toBe('0:0:0:0::/64')
    expect(ipBucket('::ffff:192.168.1.1')).toBe('0:0:0:0::/64')
  })

  it('falls back to the raw value rather than over-merging an unparseable address', () => {
    // Over-merging would let one client's traffic throttle unrelated clients.
    expect(ipBucket('2001:db8::1::2')).toBe('2001:db8::1::2')
    expect(ipBucket('nonsense:::')).toBe('nonsense:::')
  })
})

// ---------------------------------------------------------------------------
// X-Forwarded-For trust model
// ---------------------------------------------------------------------------

describe('getClientIp', () => {
  it('takes the rightmost entry, which is the one Caddy appended', () => {
    const result = getClientIp(headersOf({ 'x-forwarded-for': '10.0.0.1, 203.0.113.9' }))
    expect(result).toEqual({ ip: '203.0.113.9', reason: null })
  })

  it('ignores forged leftmost entries — the attacker cannot mint new buckets', () => {
    // Same real client, three different forged prefixes: all one bucket.
    const buckets = [
      '1.1.1.1, 203.0.113.9',
      '2.2.2.2, 3.3.3.3, 203.0.113.9',
      'not-an-ip, 203.0.113.9',
    ].map((xff) => getClientIp(headersOf({ 'x-forwarded-for': xff })).ip)

    expect(new Set(buckets).size).toBe(1)
    expect(buckets[0]).toBe('203.0.113.9')
  })

  it('honours TRUSTED_PROXY_COUNT for deployments with a CDN in front of Caddy', () => {
    setConfigEnv({ TRUSTED_PROXY_COUNT: '2' })
    const result = getClientIp(headersOf({ 'x-forwarded-for': 'forged, 203.0.113.9, 172.16.0.2' }))
    expect(result).toEqual({ ip: '203.0.113.9', reason: null })
  })

  it('ignores empty chain elements', () => {
    expect(getClientIp(headersOf({ 'x-forwarded-for': ' , , 203.0.113.9 ' })).ip).toBe('203.0.113.9')
  })

  // --- No trustworthy address: null, never a shared bucket ------------------

  it('reports no usable IP when the header is missing', () => {
    // Regression: this used to return a literal `unknown` bucket, which put
    // every caller of a proxy-less deployment into ONE login budget.
    expect(getClientIp(headersOf({}))).toEqual({ ip: null, reason: 'missing-header' })
  })

  it('reports no usable IP when the chain is shorter than the trusted hop count', () => {
    setConfigEnv({ TRUSTED_PROXY_COUNT: '3' })
    expect(getClientIp(headersOf({ 'x-forwarded-for': '203.0.113.9' }))).toEqual({
      ip: null,
      reason: 'chain-too-short',
    })
  })

  it('treats TRUSTED_PROXY_COUNT=0 as "nothing in front is trustworthy"', () => {
    setConfigEnv({ TRUSTED_PROXY_COUNT: '0' })
    expect(getClientIp(headersOf({ 'x-forwarded-for': '203.0.113.9' }))).toEqual({
      ip: null,
      reason: 'no-trusted-proxy',
    })
  })

  it('never trusts X-Real-IP as a substitute for a missing X-Forwarded-For', () => {
    // If XFF is absent there is no evidence a trusted proxy was involved, so
    // X-Real-IP is exactly as forgeable as the leftmost XFF entry.
    expect(getClientIp(headersOf({ 'x-real-ip': '203.0.113.9' })).ip).toBeNull()
  })
})

describe('consumeClientIpRateLimit', () => {
  const policy = { limit: 1, windowMs: 60_000 }

  it('applies the policy when a trustworthy address is present', async () => {
    const client = getClientIp(headersOf({ 'x-forwarded-for': '203.0.113.9' }))
    expect((await consumeClientIpRateLimit('s', client, policy, T0))?.allowed).toBe(true)
    expect((await consumeClientIpRateLimit('s', client, policy, T0))?.allowed).toBe(false)
  })

  it('returns null — meaning "no decision" — when no address can be trusted', async () => {
    const client = getClientIp(headersOf({}))
    expect(await consumeClientIpRateLimit('s', client, policy, T0)).toBeNull()
  })

  it('does not consume anyone else\'s budget when the address is untrusted', async () => {
    // The whole point of returning null: an untrusted request must not land in
    // a bucket shared with unrelated callers.
    const untrusted = getClientIp(headersOf({}))
    for (let i = 0; i < 50; i += 1) {
      await consumeClientIpRateLimit('s', untrusted, policy, T0)
    }
    const real = getClientIp(headersOf({ 'x-forwarded-for': '203.0.113.9' }))
    expect((await consumeClientIpRateLimit('s', real, policy, T0))?.allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Sliding window counter
// ---------------------------------------------------------------------------

describe('consumeRateLimit', () => {
  const policy = { limit: 3, windowMs: 60_000 }

  it('allows exactly `limit` requests and rejects the next one', async () => {
    const results = []
    for (let i = 0; i < 4; i += 1) {
      results.push(await consumeRateLimit('test', 'k', policy, T0))
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false])
    expect(results[2].remaining).toBe(0)
    expect(results[3].retryAfterSeconds).toBeGreaterThan(0)
  })

  it('decrements remaining as the window fills', async () => {
    const first = await consumeRateLimit('test', 'k', policy, T0)
    const second = await consumeRateLimit('test', 'k', policy, T0)
    expect(first.remaining).toBe(2)
    expect(second.remaining).toBe(1)
  })

  it('keeps different keys independent', async () => {
    for (let i = 0; i < 3; i += 1) await consumeRateLimit('test', 'a', policy, T0)
    const other = await consumeRateLimit('test', 'b', policy, T0)
    expect(other.allowed).toBe(true)
  })

  it('keeps different scopes independent for the same key', async () => {
    for (let i = 0; i < 3; i += 1) await consumeRateLimit('scope-a', 'k', policy, T0)
    const other = await consumeRateLimit('scope-b', 'k', policy, T0)
    expect(other.allowed).toBe(true)
  })

  it('is NOT gamed at the window boundary (the fixed-window bug)', async () => {
    // Align to a window boundary, then spend the whole budget in the last
    // millisecond of window N.
    const windowStart = Math.floor(T0 / policy.windowMs) * policy.windowMs
    const endOfWindow = windowStart + policy.windowMs - 1
    redis.now = endOfWindow
    for (let i = 0; i < 3; i += 1) {
      const r = await consumeRateLimit('test', 'k', policy, endOfWindow)
      expect(r.allowed).toBe(true)
    }

    // 2ms later we are in window N+1. A fixed window would hand out a fresh
    // budget of 3 here; the sliding window still counts the decayed previous
    // window, so the very next request is rejected.
    const startOfNext = windowStart + policy.windowMs + 1
    redis.now = startOfNext
    const immediatelyAfter = await consumeRateLimit('test', 'k', policy, startOfNext)
    expect(immediatelyAfter.allowed).toBe(false)
  })

  it('lets the budget recover as the previous window decays', async () => {
    const windowStart = Math.floor(T0 / policy.windowMs) * policy.windowMs
    const endOfWindow = windowStart + policy.windowMs - 1
    redis.now = endOfWindow
    for (let i = 0; i < 3; i += 1) await consumeRateLimit('test', 'k', policy, endOfWindow)

    // A full window later the previous counter has decayed away entirely.
    const later = windowStart + 2 * policy.windowMs + 1
    redis.now = later
    const recovered = await consumeRateLimit('test', 'k', policy, later)
    expect(recovered.allowed).toBe(true)
  })

  it('issues the increment, expiry and previous-window read in one round trip', async () => {
    redis.commands = []
    await consumeRateLimit('test', 'k', policy, T0)
    expect(redis.commands.map((c) => c[0])).toEqual(['incr', 'pexpire', 'get'])
  })

  it('counts rejected attempts too, pushing the reset further out', async () => {
    for (let i = 0; i < 4; i += 1) await consumeRateLimit('test', 'k', policy, T0)
    const first = await consumeRateLimit('test', 'k', policy, T0)
    for (let i = 0; i < 20; i += 1) await consumeRateLimit('test', 'k', policy, T0)
    const later = await consumeRateLimit('test', 'k', policy, T0)
    expect(later.retryAfterSeconds).toBeGreaterThan(first.retryAfterSeconds)
  })
})

// ---------------------------------------------------------------------------
// Switched off by configuration
// ---------------------------------------------------------------------------

describe('AUTH_RATE_LIMIT_ENABLED=false', () => {
  beforeEach(() => setConfigEnv({ AUTH_RATE_LIMIT_ENABLED: 'false' }))

  it('allows every request without touching Redis at all', async () => {
    const policy = { limit: 1, windowMs: 60_000 }
    redis.commands = []
    for (let i = 0; i < 10; i += 1) {
      const decision = await consumeRateLimit('test', 'k', policy, T0)
      expect(decision.allowed).toBe(true)
    }
    expect(redis.commands).toEqual([])
  })

  it('reports "not degraded" — off by policy is not a malfunction', async () => {
    const decision = await consumeRateLimit('test', 'k', { limit: 1, windowMs: 60_000 }, T0)
    expect(decision.degraded).toBe(false)
    expect(decision.remaining).toBe(1)
  })

  it('never locks an account out', async () => {
    for (let i = 0; i < 20; i += 1) await recordFailure('login', 'b1')
    expect(await getLockoutState('login', 'b1')).toEqual({
      locked: false,
      retryAfterSeconds: 0,
      degraded: false,
    })
  })

  it('does not fail closed even when RATE_LIMIT_FAIL_MODE=closed and Redis is down', async () => {
    // Disabled outranks fail mode: the operator turned the feature off, so
    // there is no backend whose absence could be a failure.
    setConfigEnv({ AUTH_RATE_LIMIT_ENABLED: 'false', RATE_LIMIT_FAIL_MODE: 'closed' })
    redis.failing = true
    const decision = await consumeRateLimit('test', 'k', { limit: 1, windowMs: 60_000 }, T0)
    expect(decision.allowed).toBe(true)
    expect(decision.degraded).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Backend failure handling
// ---------------------------------------------------------------------------

describe('backend failure handling', () => {
  const policy = { limit: 1, windowMs: 60_000 }

  it('fails open by default and flags the decision as degraded', async () => {
    redis.failing = true
    const decision = await consumeRateLimit('test', 'k', policy, T0)
    expect(decision.allowed).toBe(true)
    expect(decision.degraded).toBe(true)
  })

  it('fails closed when RATE_LIMIT_FAIL_MODE=closed', async () => {
    setConfigEnv({ RATE_LIMIT_FAIL_MODE: 'closed' })
    redis.failing = true
    const decision = await consumeRateLimit('test', 'k', policy, T0)
    expect(decision.allowed).toBe(false)
    expect(decision.degraded).toBe(true)
    expect(decision.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('does not hang when Redis stops responding', async () => {
    setConfigEnv({ RATE_LIMIT_TIMEOUT_MS: '20' })
    redis.hanging = true
    const started = Date.now()
    const decision = await consumeRateLimit('test', 'k', policy, T0)
    expect(decision.degraded).toBe(true)
    expect(decision.allowed).toBe(true)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('treats a lockout check against a dead backend as unlocked when failing open', async () => {
    redis.failing = true
    const state = await getLockoutState('login', 'bucket')
    expect(state).toEqual({ locked: false, retryAfterSeconds: 60, degraded: true })
  })

  it('treats a lockout check against a dead backend as locked when failing closed', async () => {
    setConfigEnv({ RATE_LIMIT_FAIL_MODE: 'closed' })
    redis.failing = true
    const state = await getLockoutState('login', 'bucket')
    expect(state.locked).toBe(true)
    expect(state.degraded).toBe(true)
  })

  it('does not lock anyone out when failure recording cannot reach Redis', async () => {
    redis.failing = true
    await expect(recordFailure('login', 'bucket')).resolves.toEqual({
      failures: 0,
      lockedForSeconds: 0,
    })
  })
})

describe('partial MULTI/EXEC failures are not read as valid data', () => {
  it('treats a failed PEXPIRE in consumeRateLimit as backend-unavailable', async () => {
    redis.failCommands = new Set(['pexpire'])
    const decision = await consumeRateLimit('test', 'k', { limit: 5, windowMs: 60_000 }, T0)
    expect(decision.degraded).toBe(true)
  })

  it('treats a failed GET in consumeRateLimit as backend-unavailable', async () => {
    // A failed GET silently zeroes the previous window, which under-counts.
    redis.failCommands = new Set(['get'])
    const decision = await consumeRateLimit('test', 'k', { limit: 5, windowMs: 60_000 }, T0)
    expect(decision.degraded).toBe(true)
  })

  it('does not report a lockout from a recordFailure whose PEXPIRE failed', async () => {
    // Without the TTL the counter never decays, so the lockout it implies is wrong.
    redis.failCommands = new Set(['pexpire'])
    const result = await recordFailure('login:account', 'bucket')
    expect(result).toEqual({ failures: 0, lockedForSeconds: 0 })
  })
})

describe('rateLimitBackendStatus', () => {
  const policy = { limit: 5, windowMs: 60_000 }

  it('reports ok before anything has failed', () => {
    expect(rateLimitBackendStatus()).toEqual({
      enabled: true,
      state: 'ok',
      lastOutageAgoMs: null,
      failMode: 'open',
    })
  })

  it('reports degraded once a request has failed to reach Redis', async () => {
    redis.failing = true
    await consumeRateLimit('test', 'k', policy, T0)

    const status = rateLimitBackendStatus()
    expect(status.state).toBe('degraded')
    expect(status.lastOutageAgoMs).toBeGreaterThanOrEqual(0)
  })

  it('recovers to ok once the outage is old enough', async () => {
    redis.failing = true
    await consumeRateLimit('test', 'k', policy, T0)
    expect(rateLimitBackendStatus().state).toBe('degraded')

    // Passive: it ages out rather than probing. 61s after the last failure the
    // limiter is reported healthy again — the next real failure re-flags it.
    expect(rateLimitBackendStatus(Date.now() + 61_000).state).toBe('ok')
  })

  it('reports disabled rather than ok when switched off', () => {
    setConfigEnv({ AUTH_RATE_LIMIT_ENABLED: 'false' })
    const status = rateLimitBackendStatus()
    expect(status.state).toBe('disabled')
    expect(status.enabled).toBe(false)
  })

  it('carries the fail mode so a degraded report can be interpreted', () => {
    setConfigEnv({ RATE_LIMIT_FAIL_MODE: 'closed' })
    expect(rateLimitBackendStatus().failMode).toBe('closed')
  })
})

// ---------------------------------------------------------------------------
// Progressive lockout
// ---------------------------------------------------------------------------

describe('lockoutDurationMs', () => {
  it('is zero below the threshold', () => {
    const cfg = getRateLimitConfig()
    expect(lockoutDurationMs(cfg.lockout.threshold - 1, cfg)).toBe(0)
  })

  it('doubles per additional failure and caps out', () => {
    const cfg = {
      lockout: { threshold: 5, baseMs: 60_000, maxMs: 900_000, failureWindowMs: 3_600_000 },
    }
    expect(lockoutDurationMs(5, cfg)).toBe(60_000)
    expect(lockoutDurationMs(6, cfg)).toBe(120_000)
    expect(lockoutDurationMs(7, cfg)).toBe(240_000)
    expect(lockoutDurationMs(8, cfg)).toBe(480_000)
    expect(lockoutDurationMs(9, cfg)).toBe(900_000)
    expect(lockoutDurationMs(50, cfg)).toBe(900_000)
  })
})

describe('recordFailure / getLockoutState / clearFailures', () => {
  beforeEach(() => {
    setConfigEnv({ AUTH_LOCKOUT_THRESHOLD: '3', AUTH_LOCKOUT_BASE_S: '60' })
  })

  it('does not lock before the threshold', async () => {
    await recordFailure('login', 'b1')
    const second = await recordFailure('login', 'b1')
    expect(second).toEqual({ failures: 2, lockedForSeconds: 0 })
    expect((await getLockoutState('login', 'b1')).locked).toBe(false)
  })

  it('locks on the Nth consecutive failure', async () => {
    await recordFailure('login', 'b1')
    await recordFailure('login', 'b1')
    const third = await recordFailure('login', 'b1')
    expect(third.failures).toBe(3)
    expect(third.lockedForSeconds).toBe(60)

    const state = await getLockoutState('login', 'b1')
    expect(state.locked).toBe(true)
    expect(state.retryAfterSeconds).toBeGreaterThan(0)
    expect(state.retryAfterSeconds).toBeLessThanOrEqual(60)
  })

  it('escalates the lockout on each further failure', async () => {
    const durations: number[] = []
    for (let i = 0; i < 5; i += 1) {
      durations.push((await recordFailure('login', 'b1')).lockedForSeconds)
    }
    expect(durations).toEqual([0, 0, 60, 120, 240])
  })

  it('releases the lock once its TTL passes', async () => {
    for (let i = 0; i < 3; i += 1) await recordFailure('login', 'b1')
    expect((await getLockoutState('login', 'b1')).locked).toBe(true)

    redis.advance(61_000)
    expect((await getLockoutState('login', 'b1')).locked).toBe(false)
  })

  it('clears both the counter and the active lock on success', async () => {
    for (let i = 0; i < 3; i += 1) await recordFailure('login', 'b1')
    expect((await getLockoutState('login', 'b1')).locked).toBe(true)

    await clearFailures('login', 'b1')

    expect((await getLockoutState('login', 'b1')).locked).toBe(false)
    // The counter restarted from zero, so the next failure is failure #1.
    expect((await recordFailure('login', 'b1')).failures).toBe(1)
  })

  it('keeps lockout state per bucket', async () => {
    for (let i = 0; i < 3; i += 1) await recordFailure('login', 'b1')
    expect((await getLockoutState('login', 'b2')).locked).toBe(false)
  })
})

describe('lock key without a TTL', () => {
  it('treats PTTL -1 as locked instead of silently unlocked, and restores expiry', async () => {
    redis.seedWithoutExpiry('rl:login:account:lock:victim', '9')

    const state = await getLockoutState('login:account', 'victim')

    expect(state.locked).toBe(true)
    expect(state.retryAfterSeconds).toBeGreaterThan(0)
    // The repair happened, so the key can no longer sit there forever.
    expect(await redis.pttl('rl:login:account:lock:victim')).toBeGreaterThan(0)
  })

  it('still reports PTTL -2 (no key) as unlocked', async () => {
    const state = await getLockoutState('login:account', 'nobody')
    expect(state.locked).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Response headers
// ---------------------------------------------------------------------------

describe('rate limit headers', () => {
  it('emits Retry-After plus the standard RateLimit-* trio', async () => {
    const policy = { limit: 1, windowMs: 60_000 }
    await consumeRateLimit('test', 'k', policy, T0)
    const denied = await consumeRateLimit('test', 'k', policy, T0)

    const headers = rateLimitHeaders(denied)
    expect(headers['RateLimit-Limit']).toBe('1')
    expect(headers['RateLimit-Remaining']).toBe('0')
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0)
    expect(Number(headers['RateLimit-Reset'])).toBeGreaterThan(0)
  })

  it('shapes lockout headers identically to rate-limit headers', () => {
    const headers = lockoutHeaders({ locked: true, retryAfterSeconds: 42, degraded: false }, 10)
    expect(Object.keys(headers).sort()).toEqual(
      ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'].sort(),
    )
    expect(headers['Retry-After']).toBe('42')
    expect(headers['RateLimit-Remaining']).toBe('0')
  })
})
