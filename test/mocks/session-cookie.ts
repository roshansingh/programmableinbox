/**
 * jsdom's fetch attaches document.cookie as a real Cookie request header
 * (verified empirically against this project's msw/node + jsdom setup), but
 * does NOT write a mocked response's Set-Cookie header back into
 * document.cookie — there is no real browser network stack behind MSW's
 * node interceptor to apply it. So: tests that want to simulate "already
 * logged in" set the cookie directly via setMockSessionCookie(), and any
 * handler that wants to simulate "this response logs the caller in" (e.g.
 * a mocked login success) must also call it as a side effect, not rely on
 * a Set-Cookie header alone.
 *
 * MSW's `cookies` convenience context (the second argument to a handler)
 * does not work in this environment either — it returns undefined even when
 * the raw Cookie header is present. getSessionCookieFromRequest parses the
 * header directly instead.
 */
export const MOCK_SESSION_COOKIE_VALUE = 'mock-session-token'

export function setMockSessionCookie(value: string = MOCK_SESSION_COOKIE_VALUE): void {
  document.cookie = `session=${value}; path=/`
}

export function clearMockSessionCookie(): void {
  document.cookie = 'session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
}

export function getSessionCookieFromRequest(request: Request): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  const match = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('session='))
  return match ? match.slice('session='.length) : null
}
