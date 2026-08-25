import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()
const inboxFindFirstMock = vi.fn()
const messageCreateMock = vi.fn()
const messageFindFirstMock = vi.fn()
const sendMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...a: unknown[]) => resolveUserPrincipalFromTokenMock(...a),
  SESSION_COOKIE_NAME: 'session',
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: { findFirst: (...a: unknown[]) => inboxFindFirstMock(...a) },
    emailMessage: {
      create: (...a: unknown[]) => messageCreateMock(...a),
      findFirst: (...a: unknown[]) => messageFindFirstMock(...a),
    },
  },
}))

vi.mock('@/lib/resend', () => ({ getResend: () => ({ emails: { send: sendMock } }) }))

const INBOX = { id: 'inbox_1', email: 'me@mail.example.com', organizationId: 'org_1', userId: 'user_1' }

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/app/emailInbox/inbox_1/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'session=token' },
    body: JSON.stringify({ to: ['dest@example.com'], subject: 'Hi', text: 'Hello' }),
  })
}

async function loadRoute() {
  return import('../route')
}

async function configurePlan(
  overrides: { outboundEmail?: boolean },
  quotaAllowed = true,
) {
  const { CommercialProvider } = await import('@/lib/commercial/provider')
  const { UNLIMITED } = await import('@/lib/commercial/plan-limits')
  const refund = vi.fn().mockResolvedValue(undefined)
  const consume = vi.fn().mockResolvedValue({
    allowed: quotaAllowed,
    limit: 100,
    used: quotaAllowed ? 1 : 100,
    resetsAt: null,
  })

  CommercialProvider.configure(
    {
      resolve: async () => ({
        planCode: 'free',
        planName: 'Free',
        limits: { ...UNLIMITED, ...overrides },
        periodStart: null,
        periodEnd: null,
      }),
    },
    { consume, refund, peek: vi.fn(), increment: vi.fn() },
    CommercialProvider.metering,
  )
  return { consume, refund, CommercialProvider }
}

describe('POST /api/app/emailInbox/[id]/send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
    inboxFindFirstMock.mockResolvedValue(INBOX)
    messageFindFirstMock.mockResolvedValue(null)
    messageCreateMock.mockResolvedValue({ id: 'msg_1' })
    sendMock.mockResolvedValue({ data: { id: 'resend_1' }, error: null })
  })

  afterEach(async () => {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    CommercialProvider.reset()
  })

  it('sends under the unlimited OSS default', async () => {
    const { POST } = await loadRoute()

    const response = await POST(makeRequest() as any, { params: Promise.resolve({ id: 'inbox_1' }) })

    expect(response.status).toBe(201)
    expect(sendMock).toHaveBeenCalled()
  })

  /**
   * The dashboard is the third outbound path alongside `forward_email` and
   * `auto_reply`. Gating only the automated ones would leave a free account
   * able to send from a domain we own just by using the UI.
   */
  it('refuses with 402 when the plan excludes outbound email', async () => {
    await configurePlan({ outboundEmail: false })
    const { POST } = await loadRoute()

    const response = await POST(makeRequest() as any, { params: Promise.resolve({ id: 'inbox_1' }) })
    const body = await response.json()

    expect(response.status).toBe(402)
    expect(body.planCode).toBe('free')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('refuses with 402 when the outbound meter is exhausted', async () => {
    await configurePlan({ outboundEmail: true }, false)
    const { POST } = await loadRoute()

    const response = await POST(makeRequest() as any, { params: Promise.resolve({ id: 'inbox_1' }) })
    const body = await response.json()

    expect(response.status).toBe(402)
    expect(body.limit).toBe(100)
    expect(body.used).toBe(100)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('consumes one unit of emails.sent on a successful send', async () => {
    const { consume } = await configurePlan({ outboundEmail: true })
    const { POST } = await loadRoute()

    await POST(makeRequest() as any, { params: Promise.resolve({ id: 'inbox_1' }) })

    expect(consume).toHaveBeenCalledWith('org_1', 'emails.sent', 1, expect.anything())
  })

  /**
   * Resend rejecting the send means nothing left the building, so charging for
   * it would let a provider outage silently eat an organization's allowance.
   */
  it('refunds the unit when Resend rejects the send', async () => {
    const { refund } = await configurePlan({ outboundEmail: true })
    sendMock.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })
    const { POST } = await loadRoute()

    const response = await POST(makeRequest() as any, { params: Promise.resolve({ id: 'inbox_1' }) })

    expect(response.status).toBe(500)
    expect(refund).toHaveBeenCalledWith('org_1', 'emails.sent', 1, expect.anything())
  })

  /**
   * Distinct from the Resend-rejection case above: here the SDK call itself
   * throws (network/DNS/timeout) instead of resolving with `{ error }`, so
   * there is no evidence the send happened. The generic catch used to swallow
   * this without refunding, letting a Resend outage burn the org's send quota
   * for messages that were never sent.
   */
  it('refunds the unit when the Resend SDK call itself throws', async () => {
    const { refund } = await configurePlan({ outboundEmail: true })
    sendMock.mockRejectedValue(new Error('socket hang up'))
    const { POST } = await loadRoute()

    const response = await POST(makeRequest() as any, { params: Promise.resolve({ id: 'inbox_1' }) })

    expect(response.status).toBe(500)
    expect(refund).toHaveBeenCalledWith('org_1', 'emails.sent', 1, expect.anything())
  })

  /**
   * Once Resend has accepted the send, the unit is spent for real — "there is
   * no un-sending on a later failure" (see the comment above the consume
   * call). A DB write failure after that point must not refund, or an
   * organization could send unlimited email for free by inducing DB errors.
   */
  it('does not refund when a post-send database write fails', async () => {
    const { refund } = await configurePlan({ outboundEmail: true })
    messageCreateMock.mockRejectedValue(new Error('connection reset'))
    const { POST } = await loadRoute()

    const response = await POST(makeRequest() as any, { params: Promise.resolve({ id: 'inbox_1' }) })

    expect(response.status).toBe(500)
    expect(sendMock).toHaveBeenCalled()
    expect(refund).not.toHaveBeenCalled()
  })

  it('does not consult a plan for an inbox the caller does not own', async () => {
    const { consume } = await configurePlan({ outboundEmail: false })
    inboxFindFirstMock.mockResolvedValue(null)
    const { POST } = await loadRoute()

    const response = await POST(makeRequest() as any, { params: Promise.resolve({ id: 'inbox_1' }) })

    // 404 rather than 402: authorization is answered before billing, so a plan
    // limit never reveals that someone else's inbox exists.
    expect(response.status).toBe(404)
    expect(consume).not.toHaveBeenCalled()
  })
})
