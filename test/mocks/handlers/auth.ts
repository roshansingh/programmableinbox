import { http, HttpResponse } from 'msw'
import { mockUser } from '../fixtures/users'
import { getSessionCookieFromRequest, setMockSessionCookie, clearMockSessionCookie } from '../session-cookie'

const BASE = 'http://localhost:4000/api'

export const authHandlers = [
  http.get(`${BASE}/app/auth/me`, ({ request }) => {
    if (!getSessionCookieFromRequest(request)) {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    return HttpResponse.json({ data: mockUser })
  }),

  http.post(`${BASE}/app/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    if (body.email === 'test@example.com' && body.password === 'password') {
      setMockSessionCookie()
      return HttpResponse.json({ data: { user: mockUser } })
    }
    return HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 })
  }),

  http.post(`${BASE}/app/auth/register`, async () => {
    setMockSessionCookie()
    return HttpResponse.json({ data: { user: mockUser } })
  }),

  http.post(`${BASE}/app/auth/logout`, () => {
    clearMockSessionCookie()
    return HttpResponse.json({ data: { loggedOut: true } })
  }),

  // Issue #102. Defaults are the happy paths; suites exercising expiry, an
  // invalid link or the 429 cooldown override these per test. MSW runs with
  // onUnhandledRequest: 'error', so an endpoint absent here is a hard failure
  // rather than a silent network error.
  http.post(`${BASE}/app/auth/verification/confirm`, async () => {
    return HttpResponse.json({ data: { verified: true } })
  }),

  http.post(`${BASE}/app/auth/verification/resend`, async () => {
    return HttpResponse.json({ data: { sent: true } })
  }),
]
