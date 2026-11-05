import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import twilio from 'twilio'

// The real service, except when a test asks it to fail the way a database outage would.
let failStore = false
vi.mock('@/lib/services/phone-ingest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/phone-ingest')>()
  return {
    ...actual,
    storeIncomingSms: (...args: Parameters<typeof actual.storeIncomingSms>) => {
      if (failStore) return Promise.reject(new Error('database is down'))
      return actual.storeIncomingSms(...args)
    },
  }
})

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from '@/app/api/webhooks/sms/route'
import logger from '@/lib/logger'
import { CommercialProvider } from '@/lib/commercial/provider'
import { prisma } from '@/lib/db'
import { withConfigEnv, setConfigEnv } from '@/test/config'
import { createOrgWithUser } from './helpers/auth'

const AUTH_TOKEN = 't'.repeat(32)
const URL_ = 'https://app.example.com/api/webhooks/sms'
const NUMBER = '+14155550100'

withConfigEnv({
  SMS_ENABLED: 'true',
  TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32),
  TWILIO_AUTH_TOKEN: AUTH_TOKEN,
  APP_BASE_URL: 'https://app.example.com',
})

const fields = {
  MessageSid: 'SM' + 'c'.repeat(32),
  From: '32665',
  To: NUMBER,
  Body: 'Your code is 481516',
  NumMedia: '0',
}

function request(
  p: Record<string, string> = fields,
  opts: { signWith?: string; url?: string; signature?: string | null; requestUrl?: string } = {},
) {
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' })
  const signature =
    opts.signature === undefined
      ? twilio.getExpectedTwilioSignature(opts.signWith ?? AUTH_TOKEN, opts.url ?? URL_, p)
      : opts.signature
  if (signature !== null) headers.set('x-twilio-signature', signature)
  return new NextRequest(opts.requestUrl ?? URL_, {
    method: 'POST',
    headers,
    body: new URLSearchParams(p).toString(),
  })
}

async function seedActiveInbox() {
  const a = await createOrgWithUser()
  return prisma.phoneInbox.create({
    data: {
      organizationId: a.org.id,
      userId: a.user.id,
      phoneNumber: NUMBER,
      countryCode: 'US',
      status: 'active',
    },
  })
}

beforeEach(() => {
  failStore = false
  vi.mocked(logger.error).mockClear()
  vi.mocked(logger.warn).mockClear()
})
afterEach(() => CommercialProvider.reset())

describe('POST /api/webhooks/sms', () => {
  it('stores a correctly signed message and answers with empty TwiML', async () => {
    const inbox = await seedActiveInbox()

    const res = await POST(request())

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/xml/)
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>')
    const [row] = await prisma.phoneMessage.findMany()
    expect(row).toMatchObject({ phoneInboxId: inbox.id, from: '32665', body: 'Your code is 481516' })
  })

  it('rejects a missing signature with 401 and stores nothing', async () => {
    await seedActiveInbox()

    const res = await POST(request(fields, { signature: null }))

    expect(res.status).toBe(401)
    expect(await prisma.phoneMessage.count()).toBe(0)
  })

  it('rejects a signature made with another token', async () => {
    await seedActiveInbox()

    const res = await POST(request(fields, { signWith: 'not-the-token' }))

    expect(res.status).toBe(401)
    expect(await prisma.phoneMessage.count()).toBe(0)
  })

  it('rejects a signature made over a host the operator did not configure', async () => {
    await seedActiveInbox()

    const res = await POST(request(fields, { url: 'https://evil.example/api/webhooks/sms' }))

    expect(res.status).toBe(401)
    expect(await prisma.phoneMessage.count()).toBe(0)
  })

  it('verifies against the configured URL even when the request arrives on another host', async () => {
    await seedActiveInbox()

    // Behind a proxy the request URL is whatever the proxy forwards; only the
    // configured origin is trusted, so a correct signature still verifies.
    const res = await POST(request(fields, { requestUrl: 'http://internal:4000/api/webhooks/sms' }))

    expect(res.status).toBe(200)
    expect(await prisma.phoneMessage.count()).toBe(1)
  })

  it('rejects a body altered after signing', async () => {
    await seedActiveInbox()
    const signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, URL_, fields)

    const res = await POST(request({ ...fields, Body: 'Your code is 000000' }, { signature }))

    expect(res.status).toBe(401)
  })

  it('answers 400 for a signed request that lacks a MessageSid', async () => {
    const { MessageSid: _omitted, ...rest } = fields

    const res = await POST(request(rest))

    expect(res.status).toBe(400)
  })

  it('answers 200 and stores nothing for a number no inbox holds, so Twilio does not retry', async () => {
    const res = await POST(request())

    expect(res.status).toBe(200)
    expect(await prisma.phoneMessage.count()).toBe(0)
  })

  it('stores a re-delivered MessageSid once', async () => {
    await seedActiveInbox()

    expect((await POST(request())).status).toBe(200)
    expect((await POST(request())).status).toBe(200)

    expect(await prisma.phoneMessage.count()).toBe(1)
  })

  it('answers 503 when SMS is disabled', async () => {
    await seedActiveInbox()
    setConfigEnv({ SMS_ENABLED: 'false' })

    const res = await POST(request())

    expect(res.status).toBe(503)
    expect(await prisma.phoneMessage.count()).toBe(0)
  })

  it('answers 500 when storing fails, so Twilio may retry', async () => {
    await seedActiveInbox()
    failStore = true

    const res = await POST(request())

    expect(res.status).toBe(500)
  })

  // Failures before the insert (lookup, plan, quota) are not logged by the
  // service, so the route has to; otherwise an outage is a 500 with no trace.
  it('logs the failure and the MessageSid when storing fails', async () => {
    await seedActiveInbox()
    failStore = true

    await POST(request())

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ messageSid: fields.MessageSid }),
      expect.any(String),
    )
  })

  // Twilio signs the URL stored on the number at purchase. If APP_BASE_URL has
  // since changed, every number starts failing here; the configured URL in the
  // log is what makes that findable.
  it('logs the URL it verified against when a signature fails', async () => {
    await POST(request(fields, { signature: 'bogus' }))

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUrl: URL_ }),
      expect.any(String),
    )
  })

  it('refuses an oversized body with 413 before reading it', async () => {
    const big = new NextRequest(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '5000000' },
      body: 'x',
    })

    const res = await POST(big)

    expect(res.status).toBe(413)
  })
})
