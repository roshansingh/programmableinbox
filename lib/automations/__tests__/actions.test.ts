import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionNodeConfig, EmailAutomationInput } from '@/lib/automations/types'

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }))

// The action module pulls in Prisma and Resend at import time; neither is used
// by the send_webhook path, so stub them out rather than standing them up.
vi.mock('@/lib/db', () => ({ prisma: { emailMessage: { update: vi.fn() }, autoReplyLedger: {} } }))
vi.mock('@/lib/resend', () => ({ getResend: vi.fn() }))

vi.mock('@/lib/security/ssrf-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/ssrf-guard')>()
  return { ...actual, safeFetch: safeFetchMock }
})

import { executeActionNode } from '@/lib/automations/actions'

const input: EmailAutomationInput = {
  messageId: 'message-1',
  inboxId: 'inbox-1',
  inboxEmail: 'inbox@test.dev',
  organizationId: 'org-1',
  from: 'sender@example.com',
  to: ['inbox@test.dev'],
  cc: [],
  bcc: [],
  subject: 'Order confirmation',
  bodyText: 'hello',
  bodyHtml: '',
  createdAt: new Date('2026-08-11T13:05:13.000Z'),
  headers: {},
  tags: [],
  hasAttachment: false,
  attachments: [],
}

const context = {
  automation: { id: 'automation-1', name: 'Notify' },
  revision: { id: 'revision-1', revision: 1 },
  inbox: { id: 'inbox-1', email: 'inbox@test.dev' },
  input,
  isDryRun: false,
}

function webhookNode(
  config: Partial<Extract<ActionNodeConfig, { actionType: 'send_webhook' }>['config']> = {}
): Extract<ActionNodeConfig, { actionType: 'send_webhook' }> {
  return {
    id: 'action-1',
    type: 'action',
    version: 1,
    actionType: 'send_webhook',
    config: {
      type: 'send_webhook_config',
      version: 1,
      url: 'https://hooks.example.com/webhook',
      method: 'POST',
      ...config,
    },
  }
}

beforeEach(() => {
  safeFetchMock.mockReset()
})

afterEach(async () => {
  const { CommercialProvider } = await import('@/lib/commercial/provider')
  CommercialProvider.reset()
})

/**
 * Installs a quota that allows delivery and spies on consume/refund, so
 * refund tests don't depend on the OSS NoopQuota default (which discards
 * every call and can't be asserted against).
 */
async function configureWebhookQuota() {
  const { CommercialProvider } = await import('@/lib/commercial/provider')
  const { UNLIMITED } = await import('@/lib/commercial/plan-limits')
  const consume = vi.fn().mockResolvedValue({ allowed: true, limit: null, used: 0, resetsAt: null })
  const refund = vi.fn().mockResolvedValue(undefined)

  CommercialProvider.configure(
    {
      resolve: async () => ({
        planCode: 'self_hosted',
        planName: 'Self-hosted',
        limits: { ...UNLIMITED, outboundWebhooks: true },
        periodStart: null,
        periodEnd: null,
      }),
    },
    { consume, refund, peek: vi.fn(), increment: vi.fn() },
    CommercialProvider.metering,
  )
  return { consume, refund }
}

describe('executeSendWebhook — SSRF guard (#39)', () => {
  it('routes the request through the SSRF guard rather than global fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    safeFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      finalUrl: 'https://hooks.example.com/webhook',
      redirects: 0,
    })

    const result = await executeActionNode(webhookNode({ secret: 'sig' }), context)

    expect(result.status).toBe('succeeded')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(safeFetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = safeFetchMock.mock.calls[0]
    expect(url).toBe('https://hooks.example.com/webhook')
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('application/json')
    expect(init.headers['x-inboxui-signing-secret']).toBe('sig')
    expect(JSON.parse(init.body)).toEqual({
      automationId: context.automation.id,
      automationRevisionId: context.revision.id,
      message: {
        messageId: input.messageId,
        inboxId: input.inboxId,
        inboxEmail: input.inboxEmail,
        organizationId: input.organizationId,
        from: input.from,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        headers: input.headers,
        tags: input.tags,
        hasAttachment: input.hasAttachment,
        attachments: input.attachments,
      },
    })
    vi.unstubAllGlobals()
  })

  it('records only the status and URL on success — no response body', async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      finalUrl: 'https://hooks.example.com/webhook',
      redirects: 0,
    })

    const result = await executeActionNode(webhookNode(), context)

    expect(result).toEqual({
      status: 'succeeded',
      output: { status: 204, url: 'https://hooks.example.com/webhook' },
    })
  })

  it('does NOT persist the upstream response body on a non-2xx response', async () => {
    // The pre-fix code stored `await response.text()` here, which is what made
    // this a *readable* SSRF: run records are visible to the tenant.
    safeFetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      finalUrl: 'https://hooks.example.com/webhook',
      redirects: 0,
    })

    const result = await executeActionNode(webhookNode(), context)

    expect(result.status).toBe('failed')
    expect(result.error).toEqual({ status: 401, bodyCaptured: false })
    expect(Object.keys(result.error ?? {})).not.toContain('body')
  })

  /**
   * webhook.deliveries is consumed before the guarded fetch, since the unit
   * has to be reserved before a tenant-controlled URL is touched at all. None
   * of the three ways delivery can fail to actually happen were refunding it.
   */
  it('refunds webhook.deliveries on a non-2xx response', async () => {
    const { consume, refund } = await configureWebhookQuota()
    safeFetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      finalUrl: 'https://hooks.example.com/webhook',
      redirects: 0,
    })

    const result = await executeActionNode(webhookNode(), context)

    expect(result.status).toBe('failed')
    expect(consume).toHaveBeenCalledWith('org-1', 'webhook.deliveries', 1)
    expect(refund).toHaveBeenCalledWith('org-1', 'webhook.deliveries', 1)
  })

  it('refunds webhook.deliveries when the destination is SSRF-blocked', async () => {
    const { refund } = await configureWebhookQuota()
    const { safeFetch: realSafeFetch } =
      await vi.importActual<typeof import('@/lib/security/ssrf-guard')>('@/lib/security/ssrf-guard')
    safeFetchMock.mockImplementation(realSafeFetch)

    const result = await executeActionNode(
      webhookNode({ url: 'http://127.0.0.1:6379/' }),
      context
    )

    expect(result.status).toBe('failed')
    expect(refund).toHaveBeenCalledWith('org-1', 'webhook.deliveries', 1)
  })

  it.each([
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://127.0.0.1:6379/',
    'http://10.0.0.5/admin',
    'http://[::ffff:127.0.0.1]/',
    'http://localhost:6379/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'file:///etc/passwd',
  ])('refuses the blocked destination %s without making a request', async (url) => {
    // The real guard is used here (only `safeFetch` is mocked in other tests —
    // this one lets the genuine implementation reject before any socket opens).
    const { safeFetch: realSafeFetch } =
      await vi.importActual<typeof import('@/lib/security/ssrf-guard')>('@/lib/security/ssrf-guard')
    safeFetchMock.mockImplementation(realSafeFetch)

    const result = await executeActionNode(webhookNode({ url, secret: 'sig' }), context)

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('ssrf_blocked')
    expect(typeof result.error?.reason).toBe('string')
    // Nothing from the destination is recorded beyond the reason it was refused.
    expect(Object.keys(result.error ?? {}).sort()).toEqual(['code', 'detail', 'host', 'reason'])
  })

  it('refunds webhook.deliveries and still propagates non-SSRF transport errors', async () => {
    const { refund } = await configureWebhookQuota()
    safeFetchMock.mockRejectedValue(new Error('socket hang up'))

    await expect(executeActionNode(webhookNode(), context)).rejects.toThrow('socket hang up')
    expect(refund).toHaveBeenCalledWith('org-1', 'webhook.deliveries', 1)
  })

  it('still short-circuits on a dry run without touching the network', async () => {
    const result = await executeActionNode(webhookNode(), { ...context, isDryRun: true })

    expect(result).toEqual({
      status: 'skipped',
      output: { dryRun: true, url: 'https://hooks.example.com/webhook', method: 'POST' },
    })
    expect(safeFetchMock).not.toHaveBeenCalled()
  })
})
