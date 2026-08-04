/**
 * Route tests for POST /api/app/auth/register — throttling of automated account
 * and resource creation. Registration creates a User, an Organization and a
 * Membership per call, so an unthrottled endpoint is a resource-exhaustion
 * primitive as well as a spam one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv, setConfigEnv } from '@/test/config'
import { FakeRedis } from '@/lib/security/__tests__/fake-redis'
import { setRateLimitRedisClient, __resetLogThrottlesForTests } from '@/lib/security/rate-limit'

const findUniqueMock = vi.fn()
const transactionMock = vi.fn()
const hashMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}))

vi.mock('bcryptjs', () => ({
  default: {
    hash: (...args: unknown[]) => hashMock(...args),
    compare: vi.fn(),
  },
}))

import { POST as registerHandler } from '../register/route'

/**
 * Next.js hands every route handler a context object alongside the request.
 * This route has no dynamic segments and ignores it, so supply an empty one
 * here rather than repeating it at every call site.
 */
const POST = (request: NextRequest) => registerHandler(request, { params: Promise.resolve({}) })

const T0 = 1_700_000_000_000
const THROTTLED = 'Too many registration attempts. Please try again later.'

const CREATED_USER = {
  id: 'u1',
  email: 'new@example.com',
  firstName: null,
  lastName: null,
  emailVerified: false,
  memberships: [
    {
      role: 'owner',
      organization: {
        id: 'o1',
        name: 'My Organization',
        slug: 'new-1',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    },
  ],
}

let redis: FakeRedis
let nowSpy: ReturnType<typeof vi.spyOn>

function makeRequest(body: object, ip = '203.0.113.5') {
  return new NextRequest('http://localhost/api/app/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `10.9.9.9, ${ip}`,
    },
    body: JSON.stringify(body),
  })
}

withConfigEnv({
  AUTH_RATE_LIMIT_ENABLED: 'true',
  AUTH_RATE_LIMIT_REGISTER_IP_MAX: '1000',
  AUTH_RATE_LIMIT_REGISTER_ACCOUNT_MAX: '1000',
})

beforeEach(() => {
  redis = new FakeRedis(T0)
  setRateLimitRedisClient(redis)
  __resetLogThrottlesForTests()

  nowSpy = vi.spyOn(Date, 'now').mockReturnValue(T0)

  findUniqueMock.mockReset().mockResolvedValue(null)
  hashMock.mockReset().mockResolvedValue('hashed')
  transactionMock.mockReset().mockResolvedValue(CREATED_USER)
})

afterEach(() => {
  nowSpy.mockRestore()
  setRateLimitRedisClient(null)
})

describe('POST /api/app/auth/register — input validation', () => {
  it('returns 400 when credentials are missing', async () => {
    expect((await POST(makeRequest({ email: 'a@example.com' }))).status).toBe(400)
  })

  it('returns 400, not 500, for a non-string password', async () => {
    // hashPassword hands the value to bcrypt, which throws on a non-string.
    // That turned client-controlled input into a server error.
    for (const password of [12345678, { toString: () => 'pw' }, ['pw123456'], true]) {
      const response = await POST(makeRequest({ email: 'a@example.com', password }))
      expect(response.status).toBe(400)
    }
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('returns 400 for non-string name fields', async () => {
    const response = await POST(
      makeRequest({ email: 'a@example.com', password: 'pw123456', firstName: 42 }),
    )
    expect(response.status).toBe(400)
  })

  it('still accepts absent optional name fields', async () => {
    const response = await POST(makeRequest({ email: 'new@example.com', password: 'pw123456' }))
    expect(response.status).toBe(200)
  })
})

describe('POST /api/app/auth/register — throttling', () => {
  it('still registers normally under the limit', async () => {
    const response = await POST(makeRequest({ email: 'new@example.com', password: 'pw123456' }))
    expect(response.status).toBe(200)
    expect((await response.json()).data.token).toEqual(expect.any(String))
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('throttles repeated registrations from one IP', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_REGISTER_IP_MAX: '2' })

    const statuses: number[] = []
    for (let i = 0; i < 3; i += 1) {
      // A distinct address each time — only the source IP is shared.
      statuses.push(
        (await POST(makeRequest({ email: `new${i}@example.com`, password: 'pw123456' }))).status,
      )
    }
    expect(statuses).toEqual([200, 200, 429])
  })

  it('stops creating accounts once throttled', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_REGISTER_IP_MAX: '1' })

    await POST(makeRequest({ email: 'a@example.com', password: 'pw123456' }))
    await POST(makeRequest({ email: 'b@example.com', password: 'pw123456' }))

    // The second call was rejected before reaching the transaction.
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('returns Retry-After and RateLimit-* headers with the 429', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_REGISTER_IP_MAX: '1' })

    await POST(makeRequest({ email: 'a@example.com', password: 'pw123456' }))
    const blocked = await POST(makeRequest({ email: 'b@example.com', password: 'pw123456' }))

    expect(blocked.status).toBe(429)
    expect((await blocked.json()).message).toBe(THROTTLED)
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(blocked.headers.get('RateLimit-Limit')).toBe('1')
    expect(blocked.headers.get('RateLimit-Remaining')).toBe('0')
    expect(Number(blocked.headers.get('RateLimit-Reset'))).toBeGreaterThan(0)
  })

  it('throttles one address across differing source IPs', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_REGISTER_ACCOUNT_MAX: '2' })

    const statuses: number[] = []
    for (let i = 0; i < 3; i += 1) {
      statuses.push(
        (
          await POST(
            makeRequest({ email: 'target@example.com', password: 'pw123456' }, `198.51.100.${i}`),
          )
        ).status,
      )
    }
    expect(statuses).toEqual([200, 200, 429])
  })

  it('does not share one budget between callers with no trustworthy IP', async () => {
    // Per-IP limiting is inactive rather than global when XFF is absent.
    setConfigEnv({ AUTH_RATE_LIMIT_REGISTER_IP_MAX: '1' })

    const noXff = (email: string) =>
      new NextRequest('http://localhost/api/app/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'pw123456' }),
      })

    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await POST(noXff(`user${i}@example.com`))).status)
    }
    expect(statuses).toEqual([200, 200, 200, 200])
  })

  it('fails open when Redis is unreachable', async () => {
    redis.failing = true
    const response = await POST(makeRequest({ email: 'new@example.com', password: 'pw123456' }))
    expect(response.status).toBe(200)
  })

  it('applies no throttling when AUTH_RATE_LIMIT_ENABLED=false', async () => {
    setConfigEnv({ AUTH_RATE_LIMIT_ENABLED: 'false', AUTH_RATE_LIMIT_REGISTER_IP_MAX: '1' })

    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) {
      statuses.push(
        (await POST(makeRequest({ email: `new${i}@example.com`, password: 'pw123456' }))).status,
      )
    }
    expect(statuses).toEqual([200, 200, 200, 200])
  })
})
