import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getEmailMock = vi.fn()
const inboxFindManyMock = vi.fn()
const messageFindFirstMock = vi.fn()
const messageCreateMock = vi.fn()
const attachmentCreateManyMock = vi.fn()
const dispatchAutomationsForEmailMock = vi.fn()

class MockResend {
  emails = {
    receiving: {
      get: getEmailMock,
    },
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
    emailMessage: {
      findFirst: (...args: unknown[]) => messageFindFirstMock(...args),
      create: (...args: unknown[]) => messageCreateMock(...args),
    },
    emailAttachment: {
      createMany: (...args: unknown[]) => attachmentCreateManyMock(...args),
    },
  },
}))

vi.mock('@/lib/automations/dispatcher', () => ({
  dispatchAutomationsForEmail: (...args: unknown[]) => dispatchAutomationsForEmailMock(...args),
}))

function sign(body: string, timestamp: string) {
  return crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET!)
    .update(`${timestamp}.${body}`)
    .digest('hex')
}

async function loadRoute() {
  return await import('../route')
}

describe('POST /api/v1/webhooks/email', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.WEBHOOK_SECRET = 'test-secret'
    messageFindFirstMock.mockResolvedValue(null)
    attachmentCreateManyMock.mockResolvedValue({ count: 0 })
    dispatchAutomationsForEmailMock.mockResolvedValue([])
  })

  it('rejects requests when signature headers are missing', async () => {
    const { POST } = await loadRoute()
    const request = new Request('http://localhost/api/v1/webhooks/email', {
      method: 'POST',
      body: JSON.stringify({
        type: 'email.received',
        data: { email_id: 'em_123' },
      }),
      headers: {
        'content-type': 'application/json',
      },
    })

    const response = await POST(request as any)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.message).toBe('Missing webhook signature')
    expect(getEmailMock).not.toHaveBeenCalled()
  })

  it('stores and dispatches the same inbound email for each matching inbox', async () => {
    inboxFindManyMock.mockResolvedValue([
      { id: 'inbox_1', email: 'support@example.com', organizationId: 'org_1' },
      { id: 'inbox_2', email: 'sales@example.com', organizationId: 'org_2' },
    ])
    messageCreateMock
      .mockResolvedValueOnce({ id: 'msg_1' })
      .mockResolvedValueOnce({ id: 'msg_2' })
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
        'x-webhook-timestamp': timestamp,
        'x-webhook-signature': sign(body, timestamp),
      },
    })

    const response = await POST(request as any)
    const responseBody = await response.json()

    expect(response.status).toBe(200)
    expect(responseBody.message).toBe('Webhook received')
    expect(messageCreateMock).toHaveBeenCalledTimes(2)
    expect(messageCreateMock.mock.calls[0][0].data.inboxEmailAddressId).toBe('inbox_1')
    expect(messageCreateMock.mock.calls[0][0].data.messageId).toBe('<provider-message@example.com>::inbox_1')
    expect(messageCreateMock.mock.calls[1][0].data.inboxEmailAddressId).toBe('inbox_2')
    expect(messageCreateMock.mock.calls[1][0].data.messageId).toBe('<provider-message@example.com>::inbox_2')
    expect(dispatchAutomationsForEmailMock).toHaveBeenCalledTimes(2)
    expect(dispatchAutomationsForEmailMock).toHaveBeenNthCalledWith(1, 'msg_1')
    expect(dispatchAutomationsForEmailMock).toHaveBeenNthCalledWith(2, 'msg_2')
  })
})
