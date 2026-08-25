import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const findUniqueMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}))

import { SESSION_COOKIE_NAME, signToken } from '@/lib/auth-server'
import { POST as logoutHandler } from '../route'

const ctx = { params: Promise.resolve({}) }

function requestWithSession(token: string) {
  return new NextRequest('http://localhost/api/app/auth/logout', {
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  })
}

beforeEach(() => {
  findUniqueMock.mockReset().mockResolvedValue({
    id: 'user_1',
    email: 'user@example.com',
    emailVerified: false,
    passwordChangedAt: null,
    memberships: [],
  })
})

describe('POST /api/app/auth/logout', () => {
  it('clears the session cookie for a signed-in (even unverified) user', async () => {
    const token = signToken({ userId: 'user_1' })
    const response = await logoutHandler(requestWithSession(token), ctx)

    expect(response.status).toBe(200)
    const setCookieHeader = response.headers.get('set-cookie') ?? ''
    expect(setCookieHeader).toMatch(/Max-Age=0/i)
  })

  it('401s with no session cookie', async () => {
    const request = new NextRequest('http://localhost/api/app/auth/logout', { method: 'POST' })
    const response = await logoutHandler(request, ctx)
    expect(response.status).toBe(401)
  })
})
