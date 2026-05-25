import { beforeEach, describe, expect, it, vi } from 'vitest'

const getEmailMock = vi.fn()
const inboxFindManyMock = vi.fn()
const enqueueEmailWebhookJobMock = vi.fn()
const mockWebhooksVerify = vi.fn()

class MockResend {
  emails = {
    receiving: {
      get: getEmailMock,
    },
  }
  webhooks = {
    verify: mockWebhooksVerify,
  }
}

vi.mock('resend', () => ({
  Resend: MockResend,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      findMany: (...args: unknown[]) => inboxFindManyMock(...args),
    },
  },
}))

vi.mock('@/lib/webhooks/queue', () => ({
  enqueueEmailWebhookJob: (...args: unknown[]) => enqueueEmailWebhookJobMock(...args),
  buildRedisOptions: () => ({}),
}))

vi.mock('@/lib/webhooks/worker', () => ({
  getEmailWebhookWorker: vi.fn(),
}))

async function loadRoute() {
  return await import('../route')
}

describe('POST /api/v1/webhooks/email', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.WEBHOOK_SECRET = 'test-secret'
    process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING = 'true'
    mockWebhooksVerify.mockReturnValue(undefined) // default: passes verification
    enqueueEmailWebhookJobMock.mockResolvedValue(undefined)
  })

  it('rejects requests when signature headers are missing', async () => {
    mockWebhooksVerify.mockImplementationOnce(() => {
      throw new Error('Invalid signature')
    })
    const { POST } = await loadRoute()
    const request = new Request('http://localhost/api/v1/webhooks/email', {
      method: 'POST',
      body: JSON.stringify({
        type: 'email.received',
        data: { email_id: 'em_123' },
      }),
      headers: {
        'content-type': 'application/json',
        'svix-id': 'msg_123',
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': 'v1,invalid',
      },
    })

    const response = await POST(request as any)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.message).toBe('Invalid webhook signature')
    expect(getEmailMock).not.toHaveBeenCalled()
  })

  it('enqueues one job per matching inbox and returns 200 immediately', async () => {
    inboxFindManyMock.mockResolvedValue([
      { id: 'inbox_1', email: 'support@example.com', organizationId: 'org_1' },
      { id: 'inbox_2', email: 'sales@example.com', organizationId: 'org_2' },
    ])
    getEmailMock.mockResolvedValue({
      data: {
        from: 'sender@example.com',
        to: ['support@example.com', 'sales@example.com'],
        cc: [],
        bcc: [],
        subject: 'Hello',
        text: 'Body',
        html: '<p>Body</p>',
        headers: { 'message-id': '<provider-message@example.com>' },
        created_at: new Date().toISOString(),
        attachments: [],
      },
    })

    const { POST } = await loadRoute()
    const body = JSON.stringify({
      type: 'email.received',
      data: { email_id: 'em_123' },
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const request = new Request('http://localhost/api/v1/webhooks/email', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'svix-id': 'msg_123',
        'svix-timestamp': timestamp,
        'svix-signature': 'v1,test-signature',
      },
    })

    const response = await POST(request as any)
    const responseBody = await response.json()

    // Route returns fast — no synchronous storage or dispatch
    expect(response.status).toBe(200)
    expect(responseBody.message).toBe('Webhook received and queued for processing')

    // One job enqueued per inbox, carrying the Resend email ID and full payload
    expect(enqueueEmailWebhookJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: expect.any(String),
        inboxEmailAddressId: 'inbox_1',
        payload: expect.objectContaining({
          from: expect.any(String),
          subject: expect.any(String),
        }),
      }),
    )
    expect(enqueueEmailWebhookJobMock).toHaveBeenCalledTimes(2)
  })

  it('returns 200 and does not enqueue when no inboxes match', async () => {
    inboxFindManyMock.mockResolvedValueOnce([])
    getEmailMock.mockResolvedValue({
      data: {
        from: 'sender@example.com',
        to: ['unknown@example.com'],
        cc: [],
        bcc: [],
        subject: 'Hello',
        text: 'Body',
        html: '<p>Body</p>',
        headers: {},
        created_at: new Date().toISOString(),
        attachments: [],
      },
    })

    const { POST } = await loadRoute()
    const body = JSON.stringify({
      type: 'email.received',
      data: { email_id: 'em_456' },
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const request = new Request('http://localhost/api/v1/webhooks/email', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'svix-id': 'msg_456',
        'svix-timestamp': timestamp,
        'svix-signature': 'v1,test-signature',
      },
    })

    const response = await POST(request as any)
    expect(response.status).toBe(200)
    expect(enqueueEmailWebhookJobMock).not.toHaveBeenCalled()
  })
})
