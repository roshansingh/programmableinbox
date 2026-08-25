import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const findUniqueMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}))

import {
  SESSION_COOKIE_NAME,
  setSessionCookie,
  clearSessionCookie,
  getAuthenticatedUser,
  signToken,
} from '@/lib/auth-server'

function requestWithCookie(value?: string) {
  return new NextRequest('http://localhost:4000/api/app/auth/me', {
    headers: value ? { cookie: `${SESSION_COOKIE_NAME}=${value}` } : {},
  })
}

beforeEach(() => {
  findUniqueMock.mockReset()
})

describe('setSessionCookie', () => {
  it('sets an httpOnly, Secure, SameSite=Strict, 7-day cookie carrying the token', () => {
    const response = NextResponse.json({})
    setSessionCookie(response, 'a.jwt.token')

    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe('a.jwt.token')

    const setCookieHeader = response.headers.get('set-cookie') ?? ''
    expect(setCookieHeader).toMatch(/HttpOnly/i)
    expect(setCookieHeader).toMatch(/Secure/i)
    expect(setCookieHeader).toMatch(/SameSite=Strict/i)
    expect(setCookieHeader).toMatch(/Path=\//i)
    expect(setCookieHeader).toMatch(/Max-Age=604800/i)
  })
})

describe('clearSessionCookie', () => {
  it('expires the cookie immediately', () => {
    const response = NextResponse.json({})
    clearSessionCookie(response)

    const setCookieHeader = response.headers.get('set-cookie') ?? ''
    expect(setCookieHeader).toMatch(/Max-Age=0/i)
  })
})

describe('getAuthenticatedUser', () => {
  it('returns null when no session cookie is present', async () => {
    expect(await getAuthenticatedUser(requestWithCookie())).toBeNull()
  })

  it('returns null when only an Authorization header is present (no cookie)', async () => {
    const request = new NextRequest('http://localhost:4000/api/app/auth/me', {
      headers: { authorization: `Bearer ${signToken({ userId: 'user_1' })}` },
    })
    expect(await getAuthenticatedUser(request)).toBeNull()
  })

  it('resolves the user for a valid session cookie', async () => {
    const token = signToken({ userId: 'user_1' })
    findUniqueMock.mockResolvedValue({ id: 'user_1', email: 'user@example.com' })

    const user = await getAuthenticatedUser(requestWithCookie(token))

    expect(user).toEqual({ id: 'user_1', email: 'user@example.com' })
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      include: { memberships: { include: { organization: true } } },
    })
  })
})
