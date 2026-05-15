import { beforeEach, describe, expect, it, vi } from 'vitest'

const getEmailMock = vi.fn()

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

async function loadRoute() {
  return await import('../route')
}

describe('POST /api/v1/webhooks/email', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
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
})
