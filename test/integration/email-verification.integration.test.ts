import { vi } from 'vitest'
import { resendClient } from './helpers/resend-stub'
const resend = vi.hoisted(() => ({ send: vi.fn(), verify: vi.fn(), receivingGet: vi.fn() }))
vi.mock('@/lib/resend', () => ({ getResend: () => resendClient(resend) }))

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { POST as register } from '@/app/api/app/auth/register/route'
import { GET as me } from '@/app/api/app/auth/me/route'
import { POST as confirm } from '@/app/api/app/auth/verification/confirm/route'
import { POST as resendVerification } from '@/app/api/app/auth/verification/resend/route'
import { GET as listInboxes } from '@/app/api/app/emailInbox/route'
import { prisma } from '@/lib/db'
import { resetConfigCache } from '@/lib/config'
import { jsonRequest } from './helpers/request'
import { SESSION_COOKIE_NAME } from '@/lib/auth-server'

const ORIGINAL = {
  ENABLE_EMAIL_VERIFICATION: process.env.ENABLE_EMAIL_VERIFICATION,
  EMAIL_LINK_SECRET: process.env.EMAIL_LINK_SECRET,
  APP_BASE_URL: process.env.APP_BASE_URL,
}

function enableVerification() {
  process.env.ENABLE_EMAIL_VERIFICATION = 'true'
  process.env.EMAIL_LINK_SECRET = 'integration-verification-secret-16'
  process.env.APP_BASE_URL = 'https://app.test.dev'
  resetConfigCache()
}

function disableVerification() {
  delete process.env.ENABLE_EMAIL_VERIFICATION
  delete process.env.EMAIL_LINK_SECRET
  delete process.env.APP_BASE_URL
  resetConfigCache()
}

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetConfigCache()
})

/** Pulls the signed token out of the link the mailer was asked to send. */
function tokenFromLastSend(): string {
  const payload = resend.send.mock.calls.at(-1)![0] as { text: string }
  const url = new URL(payload.text.match(/https:\/\/\S+/)![0])
  return url.searchParams.get('token')!
}

/**
 * The session credential now travels as a cookie on the response rather
 * than in the JSON body, so it's pulled off `res.cookies` here instead of
 * `data.token`.
 */
async function signUp(email: string) {
  const res = await register(
    jsonRequest('http://localhost/api/app/auth/register', {
      method: 'POST',
      body: { email, password: 'password123', firstName: 'Ver', lastName: 'Ify' },
    }),
  )
  expect(res.status).toBe(200)
  const { data } = await res.json()
  const token = res.cookies.get(SESSION_COOKIE_NAME)?.value
  expect(token).toEqual(expect.any(String))
  return { token: token as string, user: data.user as { id: string; emailVerified: boolean } }
}

describe('email verification, end to end', () => {
  beforeEach(() => {
    resend.send.mockReset()
    resend.send.mockResolvedValue({ data: { id: 'resend_1' }, error: null })
    enableVerification()
  })

  it('gates the dashboard until the emailed link is redeemed, then opens it', async () => {
    const email = `verify-${Date.now()}@test.dev`
    const { token, user } = await signUp(email)

    // Signup mails the user and stamps the cooldown, but leaves them unverified.
    expect(user.emailVerified).toBe(false)
    expect(resend.send).toHaveBeenCalledTimes(1)
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.emailVerified).toBe(false)
    expect(row.verificationEmailSentAt).toBeInstanceOf(Date)

    // A gated route is closed to the session the signup just issued.
    const gated = await listInboxes(
      jsonRequest('http://localhost/api/app/emailInbox', { credential: token }),
      { params: Promise.resolve({}) },
    )
    expect(gated.status).toBe(403)
    expect((await gated.json()).message).toBe('Email verification required')

    // /auth/me stays reachable — the gate screen is built from it.
    const meRes = await me(
      jsonRequest('http://localhost/api/app/auth/me', { credential: token }),
      { params: Promise.resolve({}) },
    )
    expect(meRes.status).toBe(200)
    const meBody = (await meRes.json()).data
    expect(meBody.emailVerified).toBe(false)
    expect(meBody.config.emailVerificationRequired).toBe(true)

    // Redeem the link exactly as the browser would.
    const confirmRes = await confirm(
      jsonRequest('http://localhost/api/app/auth/verification/confirm', {
        method: 'POST',
        body: { token: tokenFromLastSend() },
      }),
      { params: Promise.resolve({}) },
    )
    expect(confirmRes.status).toBe(200)
    expect((await confirmRes.json()).data).toEqual({ verified: true })

    // The same session now passes the gate — no re-login.
    const opened = await listInboxes(
      jsonRequest('http://localhost/api/app/emailInbox', { credential: token }),
      { params: Promise.resolve({}) },
    )
    expect(opened.status).toBe(200)

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBe(true)
  })

  it('treats a second redemption of the same link as a success no-op', async () => {
    const { user } = await signUp(`twice-${Date.now()}@test.dev`)
    const link = tokenFromLastSend()

    const first = await confirm(
      jsonRequest('http://localhost/api/app/auth/verification/confirm', {
        method: 'POST',
        body: { token: link },
      }),
      { params: Promise.resolve({}) },
    )
    const second = await confirm(
      jsonRequest('http://localhost/api/app/auth/verification/confirm', {
        method: 'POST',
        body: { token: link },
      }),
      { params: Promise.resolve({}) },
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await second.json()).data).toEqual({ verified: true })
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBe(true)
  })

  /**
   * The email in the claims is what makes an un-revocable token safe: changing
   * the address invalidates every link outstanding for that user, with no
   * token table to sweep.
   */
  it('refuses a link issued for an address the user no longer has', async () => {
    const { user } = await signUp(`changed-${Date.now()}@test.dev`)
    const link = tokenFromLastSend()

    await prisma.user.update({
      where: { id: user.id },
      data: { email: `moved-${Date.now()}@test.dev` },
    })

    const res = await confirm(
      jsonRequest('http://localhost/api/app/auth/verification/confirm', {
        method: 'POST',
        body: { token: link },
      }),
      { params: Promise.resolve({}) },
    )

    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe('This link is no longer valid')
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).toBe(false)
  })

  /**
   * The load-bearing separation (§6.1), against the real signing keys rather
   * than a mock: a session token must be worthless as a verification link and
   * vice versa.
   */
  it('will not accept a session token as a verification link', async () => {
    const { token } = await signUp(`confuse-${Date.now()}@test.dev`)

    const res = await confirm(
      jsonRequest('http://localhost/api/app/auth/verification/confirm', {
        method: 'POST',
        body: { token },
      }),
      { params: Promise.resolve({}) },
    )

    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe('This verification link is invalid')
  })

  it('will not accept a verification token as a session credential', async () => {
    await signUp(`confuse2-${Date.now()}@test.dev`)
    const link = tokenFromLastSend()

    const res = await me(
      jsonRequest('http://localhost/api/app/auth/me', { credential: link }),
      { params: Promise.resolve({}) },
    )

    expect(res.status).toBe(401)
  })

  it('throttles resend, then allows it once the cooldown has passed', async () => {
    const { token, user } = await signUp(`resend-${Date.now()}@test.dev`)
    expect(resend.send).toHaveBeenCalledTimes(1)

    const throttled = await resendVerification(
      jsonRequest('http://localhost/api/app/auth/verification/resend', {
        method: 'POST',
        credential: token,
      }),
      { params: Promise.resolve({}) },
    )
    expect(throttled.status).toBe(429)
    expect(resend.send).toHaveBeenCalledTimes(1)

    // Backdate the stamp rather than waiting a real minute.
    await prisma.user.update({
      where: { id: user.id },
      data: { verificationEmailSentAt: new Date(Date.now() - 120_000) },
    })

    const allowed = await resendVerification(
      jsonRequest('http://localhost/api/app/auth/verification/resend', {
        method: 'POST',
        credential: token,
      }),
      { params: Promise.resolve({}) },
    )
    expect(allowed.status).toBe(200)
    expect((await allowed.json()).data).toEqual({ sent: true })
    expect(resend.send).toHaveBeenCalledTimes(2)

    // A link from the second mail redeems just as well as the first: a resend
    // deliberately does not invalidate what came before it.
    const res = await confirm(
      jsonRequest('http://localhost/api/app/auth/verification/confirm', {
        method: 'POST',
        body: { token: tokenFromLastSend() },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)
  })

  it('does not fail the signup when the mail cannot be sent', async () => {
    resend.send.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })

    const email = `bounce-${Date.now()}@test.dev`
    const { user } = await signUp(email)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.emailVerified).toBe(false)
    // No cooldown stamped for mail that never went out, so Resend is available
    // immediately as the recovery path.
    expect(row.verificationEmailSentAt).toBeNull()
  })
})

describe('email verification disabled', () => {
  beforeEach(() => {
    resend.send.mockReset()
    resend.send.mockResolvedValue({ data: { id: 'resend_1' }, error: null })
    disableVerification()
  })

  it('leaves signup and the dashboard exactly as they were', async () => {
    const { token, user } = await signUp(`off-${Date.now()}@test.dev`)

    expect(resend.send).not.toHaveBeenCalled()
    expect(user.emailVerified).toBe(false)

    const res = await listInboxes(
      jsonRequest('http://localhost/api/app/emailInbox', { credential: token }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)
  })

  it('404s both verification endpoints', async () => {
    const { token } = await signUp(`off2-${Date.now()}@test.dev`)

    const confirmRes = await confirm(
      jsonRequest('http://localhost/api/app/auth/verification/confirm', {
        method: 'POST',
        body: { token: 'anything' },
      }),
      { params: Promise.resolve({}) },
    )
    const resendRes = await resendVerification(
      jsonRequest('http://localhost/api/app/auth/verification/resend', {
        method: 'POST',
        credential: token,
      }),
      { params: Promise.resolve({}) },
    )

    expect(confirmRes.status).toBe(404)
    expect(resendRes.status).toBe(404)
  })
})
