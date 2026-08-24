/**
 * mcp_tool_called (every tool invocation) and plan_limit_denied (the
 * create-inbox tool's own plan-cap rejection) — issue #152.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withConfigEnv } from '@/test/config'

const listInboxesMock = vi.fn()
const createInboxMock = vi.fn()
const captureEventMock = vi.fn()

vi.mock('@/lib/services/email-inbox', () => ({
  listInboxes: (...a: unknown[]) => listInboxesMock(...a),
  listMessages: vi.fn(),
  getMessage: vi.fn(),
  createInbox: (...a: unknown[]) => createInboxMock(...a),
  updateInboxForWrite: vi.fn(),
  findLatestOtp: vi.fn(),
  OTP_DEFAULT_WINDOW_MINUTES: 15,
}))

vi.mock('@/lib/product-analytics/capture', () => ({
  captureEvent: (...args: unknown[]) => captureEventMock(...args),
  PRODUCT_ANALYTICS_EVENTS: { mcpToolCalled: 'mcp_tool_called', planLimitDenied: 'plan_limit_denied' },
}))

const KEY = {
  kind: 'apiKey' as const,
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  userId: 'user_1',
  scopes: ['email_inboxes:read', 'email_inboxes:create'],
}

/** A minimal fake of the one McpServer method registerEmailTools calls. */
function fakeServer() {
  const handlers = new Map<string, (args: unknown) => Promise<unknown>>()
  return {
    registerTool: (name: string, _config: unknown, handler: (args: unknown) => Promise<unknown>) => {
      handlers.set(name, handler)
    },
    call: (name: string, args: unknown = {}) => {
      const handler = handlers.get(name)
      if (!handler) throw new Error(`no handler registered for ${name}`)
      return handler(args)
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  listInboxesMock.mockResolvedValue([])
})

describe('product analytics disabled (the default)', () => {
  withConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })

  it('does not capture a tool call', async () => {
    const { registerEmailTools } = await import('../tools')
    const server = fakeServer()
    registerEmailTools(server as never, KEY)

    await server.call('pibx_email_list_inboxes')

    expect(captureEventMock).not.toHaveBeenCalled()
  })
})

describe('product analytics enabled', () => {
  withConfigEnv({
    ENABLE_PRODUCT_ANALYTICS: 'true',
    POSTHOG_API_KEY: 'phc_test1234567890',
    POSTHOG_HOST: 'https://us.i.posthog.com',
  })

  it('captures mcp_tool_called for every registered tool, with the tool name', async () => {
    const { registerEmailTools } = await import('../tools')
    const server = fakeServer()
    registerEmailTools(server as never, KEY)

    await server.call('pibx_email_list_inboxes')

    expect(captureEventMock).toHaveBeenCalledWith(
      'mcp_tool_called',
      'user_1',
      expect.objectContaining({ tool: 'pibx_email_list_inboxes' }),
    )
  })

  it('fires even when the tool call itself errors (a scope refusal, say)', async () => {
    const { registerEmailTools } = await import('../tools')
    const server = fakeServer()
    const readOnly = { ...KEY, scopes: ['email_inboxes:read'] }
    registerEmailTools(server as never, readOnly)

    const result = (await server.call('pibx_email_create_inbox', { email: 'a@corp.com' })) as {
      isError?: boolean
    }

    expect(result.isError).toBe(true)
    expect(captureEventMock).toHaveBeenCalledWith(
      'mcp_tool_called',
      'user_1',
      expect.objectContaining({ tool: 'pibx_email_create_inbox' }),
    )
  })

  it('also captures plan_limit_denied when create_inbox is refused by a plan cap', async () => {
    createInboxMock.mockResolvedValue({
      error: {
        message: 'Your Free plan allows 1 email inbox. Upgrade to add more.',
        status: 402,
        limit: 1,
        used: 1,
        planCode: 'free',
      },
    })

    const { registerEmailTools } = await import('../tools')
    const server = fakeServer()
    registerEmailTools(server as never, KEY)

    await server.call('pibx_email_create_inbox', { email: 'a@corp.com' })

    expect(captureEventMock).toHaveBeenCalledWith(
      'plan_limit_denied',
      'user_1',
      expect.objectContaining({ resource: 'emailInboxes', planCode: 'free' }),
    )
  })

  it('does not capture plan_limit_denied for a non-plan create_inbox rejection', async () => {
    createInboxMock.mockResolvedValue({
      error: { message: 'Email address is not available', status: 409 },
    })

    const { registerEmailTools } = await import('../tools')
    const server = fakeServer()
    registerEmailTools(server as never, KEY)

    await server.call('pibx_email_create_inbox', { email: 'a@corp.com' })

    expect(captureEventMock).not.toHaveBeenCalledWith('plan_limit_denied', expect.anything(), expect.anything())
  })
})
