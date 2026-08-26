/**
 * Route tests for POST /api/app/auth/login — throttling, lockout and the
 * enumeration-safety properties of the 429 response.
 *
 * The real limiter runs against an in-memory Redis fake, so these exercise the
 * production decision path end to end; only Prisma, bcrypt and Redis storage
 * are stubbed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv, setConfigEnv } from '@/test/config'
import { FakeRedis } from '@/lib/security/__tests__/fake-redis'
import { setRateLimitRedisClient, __resetLogThrottlesForTests } from '@/lib/security/rate-limit'
import { SESSION_COOKIE_NAME } from '@/lib/auth-server'

const findUniqueMock = vi.fn()
const compareMock = vi.fn()
const hashMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
  },
}))

vi.mock('bcryptjs', () => ({
  default: {
    compare: (...args: unknown[]) => compareMock(...args),
    hash: (...args: unknown[]) => hashMock(...args),
  },
}))

import { POST as loginHandler } from '../login/route'

/**
 * Next.js hands every route handler a context object alongside the request.
 * This route has no dynamic segments and ignores it, so supply an empty one
 * here rather than repeating it at forty call sites.
 */
const POST = (request: NextRequest) => loginHandler(request, { params: Promise.resolve({}) })

const T0 = 1_700_000_000_000
const THROTTLED = 'Too many login attempts. Please try again later.'
const INVALID = 'Invalid email or password'

const USER = {
  id: 'u1',
  email: 'user@example.com',
  passwordHash: 'stored-hash',
  firstName: 'Ada',
  lastName: 'Lovelace',
  emailVerified: true,
  memberships: [
    {
      role: 'owner',
      organization: {
        id: 'o1',
        name: 'Org',
        slug: 'org',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    },
  ],
}

let redis: FakeRedis
let nowSpy: ReturnType<typeof vi.spyOn>

/**
 * Every request carries a forged leftmost XFF entry. The limiter must ignore
 * it and bucket on the rightmost element (the one Caddy appends).
 */
function makeRequest(body: object, ip = '203.0.113.5') {
  return new NextRequest('http://localhost/api/app/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `10.9.9.9, ${ip}`,
    },
    body: JSON.stringify(body),
  })
}

function rateLimitHeadersOf(response: Response) {
  return {
    retryAfter: response.headers.get('Retry-After'),
    limit: response.headers.get('RateLimit-Limit'),
    remaining: response.headers.get('RateLimit-Remaining'),
    reset: response.headers.get('RateLimit-Reset'),
  }
}

/** Generous ceilings so a test only trips the limiter it is exercising. */
withConfigEnv({
  AUTH_RATE_LIMIT_ENABLED: 'true',
  AUTH_RATE_LIMIT_LOGIN_IP_MAX: '1000',
  AUTH_RATE_LIMIT_LOGIN_ACCOUNT_MAX: '1000',
  AUTH_LOCKOUT_THRESHOLD: '1000',
})

beforeEach(() => {
  redis = new FakeRedis(T0)
  setRateLimitRedisClient(redis)
  __resetLogThrottlesForTests()

  nowSpy = vi.spyOn(Date, 'now').mockReturnValue(T0)

  findUniqueMock.mockReset().mockResolvedValue(USER)
  compareMock.mockReset().mockResolvedValue(false)
})

afterEach(() => {
  nowSpy.mockRestore()
  setRateLimitRedisClient(null)
})

// ---------------------------------------------------------------------------
// Baseline behaviour
// ---------------------------------------------------------------------------

describe('POST /api/app/auth/login — baseline', () => {
  it('returns 400 when credentials are missing', async () => {
    expect((await POST(makeRequest({ email: 'user@example.com' }))).status).toBe(400)
  })

  it('returns 400 rather than 500 for a non-string password', async () => {
    const response = await POST(makeRequest({ email: 'user@example.com', password: { a: 1 } }))
    expect(response.status).toBe(400)
  })

  it('returns 200, sets the session cookie, and puts no token in the body', async () => {
    compareMock.mockResolvedValue(true)
    const response = await POST(makeRequest({ email: 'user@example.com', password: 'correct' }))

    expect(response.status).toBe(200)
    expect((await response.json()).data.token).toBeUndefined()

    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toEqual(expect.any(String))
    const setCookieHeader = response.headers.get('set-cookie') ?? ''
    expect(setCookieHeader).toMatch(/HttpOnly/i)
    expect(setCookieHeader).toMatch(/Secure/i)
    expect(setCookieHeader).toMatch(/SameSite=Strict/i)
  })

  it('returns the generic message for a wrong password', async () => {
    const response = await POST(makeRequest({ email: 'user@example.com', password: 'nope' }))
    expect(response.status).toBe(401)
    expect((await response.json()).message).toBe(INVALID)
  })

  it('returns the identical message for an unknown account, and still runs bcrypt', async () => {
    findUniqueMock.mockResolvedValue(null)
    const response = await POST(makeRequest({ email: 'ghost@example.com', password: 'nope' }))

    expect(response.status).toBe(401)
    expect((await response.json()).message).toBe(INVALID)
    // Constant work: the comparison runs against a dummy hash rather than
    // being skipped, so "no such account" is not a timing oracle.
    expect(compareMock).toHaveBeenCalledTimes(1)
    expect(compareMock).toHaveBeenCalledWith('nope', expect.stringContaining('$2b$10$'))
  })
})

// ---------------------------------------------------------------------------
// Content-Type enforcement — closes the CORS-safelisted-simple-request path
// ---------------------------------------------------------------------------

describe('POST /api/app/auth/login — Content-Type enforcement', () => {
  function requestWithContentType(contentType: string | undefined) {
    const headers: Record<string, string> = {
      'x-forwarded-for': '10.9.9.9, 203.0.113.5',
    }
    if (contentType !== undefined) {
      headers['Content-Type'] = contentType
    }
    return new NextRequest('http://localhost/api/app/auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'user@example.com', password: 'correct' }),
    })
  }

  it('rejects a text/plain body with 415 before touching the database', async () => {
    // text/plain is one of the three CORS-safelisted content types, so a
    // cross-origin caller can send it with no preflight.
    const response = await POST(requestWithContentType('text/plain'))

    expect(response.status).toBe(415)
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('rejects a missing Content-Type header with 415', async () => {
    const response = await POST(requestWithContentType(undefined))
    expect(response.status).toBe(415)
  })

  it('still logs in with application/json, charset suffix included', async () => {
    compareMock.mockResolvedValue(true)
    const response = await POST(requestWithContentType('application/json; charset=utf-8'))
    expect(response.status).toBe(200)
  })

  it('still logs in with a bare application/json', async () => {
    compareMock.mockResolvedValue(true)
    const response = await POST(requestWithContentType('application/json'))
    expect(response.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Per-IP limiting — the one control that rejects before bcrypt
// ---------------------------------------------------------------------------

describe('POST /api/app/auth/login — per-IP limiting', () => {
  it('returns 429 on the Nth attempt from one IP', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_LOGIN_IP_MAX: '3' })

    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) {
      // A different account each time — only the IP is shared.
      const response = await POST(makeRequest({ email: `victim${i}@example.com`, password: 'g' }))
      statuses.push(response.status)
    }
    expect(statuses).toEqual([401, 401, 401, 429])
  })

  it('rejects without running bcrypt, so one source cannot burn CPU', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_LOGIN_IP_MAX: '1' })

    await POST(makeRequest({ email: 'a@example.com', password: 'x' }))
    expect(compareMock).toHaveBeenCalledTimes(1)

    const blocked = await POST(makeRequest({ email: 'b@example.com', password: 'x' }))
    expect(blocked.status).toBe(429)
    // Still 1: the throttled request never reached the password check.
    expect(compareMock).toHaveBeenCalledTimes(1)
  })

  it('sends Retry-After and the RateLimit-* headers with the 429', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_LOGIN_IP_MAX: '1' })
    await POST(makeRequest({ email: 'a@example.com', password: 'x' }))
    const blocked = await POST(makeRequest({ email: 'b@example.com', password: 'x' }))

    expect(blocked.status).toBe(429)
    expect((await blocked.json()).message).toBe(THROTTLED)
    const headers = rateLimitHeadersOf(blocked)
    expect(Number(headers.retryAfter)).toBeGreaterThan(0)
    expect(headers.limit).toBe('1')
    expect(headers.remaining).toBe('0')
    expect(Number(headers.reset)).toBeGreaterThan(0)
  })

  it('cannot be bypassed by forging the leftmost X-Forwarded-For entry', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_LOGIN_IP_MAX: '2' })

    // Same real client (rightmost), three different forged prefixes.
    const statuses: number[] = []
    for (const prefix of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      const request = new NextRequest('http://localhost/api/app/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': `${prefix}, 198.51.100.7`,
        },
        body: JSON.stringify({ email: 'a@example.com', password: 'x' }),
      })
      statuses.push((await POST(request)).status)
    }
    expect(statuses).toEqual([401, 401, 429])
  })

  it('is inactive, not global, when no trustworthy client IP exists', async () => {
    // Regression: an `unknown` shared bucket put every caller of a proxy-less
    // deployment into one login budget, which is an outage, not a safe default.
    setConfigEnv({ AUTH_RATE_LIMIT_LOGIN_IP_MAX: '2' })

    const noXff = (email: string) =>
      new NextRequest('http://localhost/api/app/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'x' }),
      })

    const statuses: number[] = []
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await POST(noXff(`user${i}@example.com`))).status)
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401])
  })
})

// ---------------------------------------------------------------------------
// Per-account limiting and lockout — report, then defer to the password
// ---------------------------------------------------------------------------

describe('POST /api/app/auth/login — per-account limiting', () => {
  it('limits one account across differing source IPs when the password is wrong', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_LOGIN_ACCOUNT_MAX: '3' })

    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) {
      const response = await POST(
        makeRequest({ email: 'user@example.com', password: `guess${i}` }, `198.51.100.${i}`),
      )
      statuses.push(response.status)
    }
    expect(statuses).toEqual([401, 401, 401, 429])
  })

  it('leaves other accounts on the same IP unaffected', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_LOGIN_ACCOUNT_MAX: '2' })

    for (let i = 0; i < 3; i += 1) {
      await POST(makeRequest({ email: 'user@example.com', password: 'x' }, '198.51.100.9'))
    }
    const blocked = await POST(
      makeRequest({ email: 'user@example.com', password: 'x' }, '198.51.100.9'),
    )
    const other = await POST(
      makeRequest({ email: 'someone.else@example.com', password: 'x' }, '198.51.100.9'),
    )

    expect(blocked.status).toBe(429)
    expect(other.status).toBe(401)
  })

  it('treats address casing and padding as the same account', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_LOGIN_ACCOUNT_MAX: '2' })

    await POST(makeRequest({ email: 'user@example.com', password: 'x' }, '198.51.100.1'))
    await POST(makeRequest({ email: '  USER@Example.COM ', password: 'x' }, '198.51.100.2'))
    const blocked = await POST(
      makeRequest({ email: 'User@example.com', password: 'x' }, '198.51.100.3'),
    )
    expect(blocked.status).toBe(429)
  })

  // --- The account-DoS fix -------------------------------------------------

  it('still admits the CORRECT password once the account budget is exhausted', async () => {
    // Otherwise anyone who knows an address could spend a handful of requests
    // an hour and keep its owner permanently unable to log in. The sliding
    // window never decays under sustained pressure, so that denial had no
    // ceiling — a worse primitive than the (capped) lockout.
    setConfigEnv({ AUTH_RATE_LIMIT_LOGIN_ACCOUNT_MAX: '2' })

    for (let i = 0; i < 5; i += 1) {
      await POST(makeRequest({ email: 'user@example.com', password: 'attacker-guess' }))
    }
    const blocked = await POST(makeRequest({ email: 'user@example.com', password: 'wrong' }))
    expect(blocked.status).toBe(429)

    compareMock.mockResolvedValue(true)
    const owner = await POST(makeRequest({ email: 'user@example.com', password: 'correct' }))
    expect(owner.status).toBe(200)
  })

  it('still admits the CORRECT password while the account is locked out, and clears the lock', async () => {
    setConfigEnv({ AUTH_LOCKOUT_THRESHOLD: '2' })

    await POST(makeRequest({ email: 'user@example.com', password: 'g' }))
    await POST(makeRequest({ email: 'user@example.com', password: 'g' }))
    expect((await POST(makeRequest({ email: 'user@example.com', password: 'g' }))).status).toBe(429)

    compareMock.mockResolvedValue(true)
    expect((await POST(makeRequest({ email: 'user@example.com', password: 'ok' }))).status).toBe(200)

    // The lock is gone, so a subsequent wrong password is a plain 401 again
    // rather than still being throttled by the attacker's leftovers.
    compareMock.mockResolvedValue(false)
    expect((await POST(makeRequest({ email: 'user@example.com', password: 'g' }))).status).toBe(401)
  })

  it('does NOT let a correct password bypass the per-IP limit', async () => {
    // The IP limit is the CPU guard and stays absolute.
    setConfigEnv({ AUTH_RATE_LIMIT_LOGIN_IP_MAX: '1' })
    compareMock.mockResolvedValue(true)

    expect((await POST(makeRequest({ email: 'user@example.com', password: 'ok' }))).status).toBe(200)
    expect((await POST(makeRequest({ email: 'user@example.com', password: 'ok' }))).status).toBe(429)
  })
})

// ---------------------------------------------------------------------------
// Progressive lockout
// ---------------------------------------------------------------------------

describe('POST /api/app/auth/login — lockout', () => {
  it('locks the account after N consecutive failures', async () => {
    setConfigEnv({ AUTH_LOCKOUT_THRESHOLD: '3' })

    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) {
      const response = await POST(
        makeRequest({ email: 'user@example.com', password: 'guess' }, `198.51.100.${i}`),
      )
      statuses.push(response.status)
    }
    expect(statuses).toEqual([401, 401, 401, 429])
    // The lockout uses the same message as a rate-limit rejection.
    const blocked = await POST(makeRequest({ email: 'user@example.com', password: 'guess' }))
    expect((await blocked.json()).message).toBe(THROTTLED)
  })

  it('releases the account once the lockout expires', async () => {
    setConfigEnv({ AUTH_LOCKOUT_THRESHOLD: '2', AUTH_LOCKOUT_BASE_S: '60' })

    // Two failures arm a 60s lock; the second still answers 401 because the
    // lock state is read before this attempt's failure is recorded.
    await POST(makeRequest({ email: 'user@example.com', password: 'guess' }))
    await POST(makeRequest({ email: 'user@example.com', password: 'guess' }))

    redis.advance(61_000)
    expect((await POST(makeRequest({ email: 'user@example.com', password: 'g' }))).status).toBe(401)
  })

  it('escalates the lock when a locked-out client keeps hammering', async () => {
    // Failures are recorded even for throttled attempts, so continuing to
    // guess pushes your own release further out: 60s, then 120s. Harmless to
    // the account owner, who is admitted by a correct password regardless.
    setConfigEnv({ AUTH_LOCKOUT_THRESHOLD: '2', AUTH_LOCKOUT_BASE_S: '60' })

    await POST(makeRequest({ email: 'user@example.com', password: 'guess' }))
    await POST(makeRequest({ email: 'user@example.com', password: 'guess' }))
    // Locked, and this attempt escalates the lock from 60s to 120s.
    expect((await POST(makeRequest({ email: 'user@example.com', password: 'g' }))).status).toBe(429)

    // Past the original 60s but not the escalated 120s — proof it escalated.
    // This attempt escalates again, so hammering never reaches a release.
    redis.advance(61_000)
    expect((await POST(makeRequest({ email: 'user@example.com', password: 'g' }))).status).toBe(429)

    // Stop hammering and wait out the longest possible lock (capped at 900s).
    redis.advance(901_000)
    expect((await POST(makeRequest({ email: 'user@example.com', password: 'g' }))).status).toBe(401)
  })

  it('clears the failure counter after a successful login', async () => {
    setConfigEnv({ AUTH_LOCKOUT_THRESHOLD: '3' })

    await POST(makeRequest({ email: 'user@example.com', password: 'guess' }))
    await POST(makeRequest({ email: 'user@example.com', password: 'guess' }))

    compareMock.mockResolvedValue(true)
    expect((await POST(makeRequest({ email: 'user@example.com', password: 'ok' }))).status).toBe(200)

    // The counter restarted: three more failures are needed to lock again, so
    // all three come back as 401. Without the reset the second one would have
    // hit the threshold and the third would be a 429.
    compareMock.mockResolvedValue(false)
    const statuses: number[] = []
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await POST(makeRequest({ email: 'user@example.com', password: 'g' }))).status)
    }
    expect(statuses).toEqual([401, 401, 401])
  })
})

// ---------------------------------------------------------------------------
// Enumeration safety
// ---------------------------------------------------------------------------

describe('POST /api/app/auth/login — the 429 reveals nothing about the account', () => {
  it('produces an identical throttled response for real and unknown accounts', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_LOGIN_ACCOUNT_MAX: '2' })

    async function throttleUntilBlocked(email: string) {
      let last!: Response
      for (let i = 0; i < 3; i += 1) {
        last = await POST(makeRequest({ email, password: 'guess' }))
      }
      return { status: last.status, body: await last.json(), headers: rateLimitHeadersOf(last) }
    }

    findUniqueMock.mockResolvedValue(USER)
    const existing = await throttleUntilBlocked('user@example.com')

    findUniqueMock.mockResolvedValue(null)
    const missing = await throttleUntilBlocked('nobody-here@example.com')

    expect(existing.status).toBe(429)
    expect(missing).toEqual(existing)
  })

  it('records failures for unknown addresses, so lockout is not an oracle', async () => {
    setConfigEnv({ AUTH_LOCKOUT_THRESHOLD: '2' })
    findUniqueMock.mockResolvedValue(null)

    await POST(makeRequest({ email: 'nobody@example.com', password: 'x' }))
    await POST(makeRequest({ email: 'nobody@example.com', password: 'x' }))
    const blocked = await POST(makeRequest({ email: 'nobody@example.com', password: 'x' }))

    expect(blocked.status).toBe(429)
    expect((await blocked.json()).message).toBe(THROTTLED)
  })
})

// ---------------------------------------------------------------------------
// Backend states
// ---------------------------------------------------------------------------

describe('POST /api/app/auth/login — Redis outage', () => {
  it('fails open by default so an outage does not take authentication down', async () => {
    redis.failing = true
    compareMock.mockResolvedValue(true)

    const response = await POST(makeRequest({ email: 'user@example.com', password: 'correct' }))
    expect(response.status).toBe(200)
  })

  it('fails closed when RATE_LIMIT_FAIL_MODE=closed', async () => {
    setConfigEnv({ RATE_LIMIT_FAIL_MODE: 'closed' })
    redis.failing = true
    compareMock.mockResolvedValue(true)

    const response = await POST(makeRequest({ email: 'user@example.com', password: 'correct' }))
    expect(response.status).toBe(429)
  })
})

describe('POST /api/app/auth/login — AUTH_RATE_LIMIT_ENABLED=false', () => {
  it('applies no throttling at all', async () => {
    setConfigEnv({
      AUTH_RATE_LIMIT_ENABLED: 'false',
      AUTH_RATE_LIMIT_LOGIN_IP_MAX: '1',
      AUTH_RATE_LIMIT_LOGIN_ACCOUNT_MAX: '1',
      AUTH_LOCKOUT_THRESHOLD: '1',
    })

    const statuses: number[] = []
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await POST(makeRequest({ email: 'user@example.com', password: 'g' }))).status)
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401])
  })
})
