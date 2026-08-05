import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { setConfigEnv, withConfigEnv } from '@/test/config'
import packageJson from '@/package.json'

const resolveApiKeyPrincipalMock = vi.fn()
const listInboxesMock = vi.fn()
const listMessagesMock = vi.fn()
const getMessageMock = vi.fn()
const consumeRateLimitMock = vi.fn()

vi.mock('@/lib/auth/api-key-auth', () => ({
  resolveApiKeyPrincipal: (...a: unknown[]) => resolveApiKeyPrincipalMock(...a),
}))

vi.mock('@/lib/services/email-inbox', () => ({
  listInboxes: (...a: unknown[]) => listInboxesMock(...a),
  listMessages: (...a: unknown[]) => listMessagesMock(...a),
  getMessage: (...a: unknown[]) => getMessageMock(...a),
}))

vi.mock('@/lib/security/rate-limit', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/security/rate-limit')>()
  return {
    ...actual,
    consumeRateLimit: (...a: unknown[]) => consumeRateLimitMock(...a),
  }
})

const KEY = {
  kind: 'apiKey',
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  scopes: ['inboxes:read', 'messages:read'],
}

const ALLOWED = {
  allowed: true,
  limit: 120,
  remaining: 119,
  retryAfterSeconds: 0,
  resetSeconds: 60,
  degraded: false,
  scope: 'mcp',
}

function rpcRequest(
  body: unknown,
  headers: Record<string, string> = {},
  credential = 'Bearer sk_live_abcdef123456',
) {
  return new NextRequest('http://localhost:4000/api/mcp', {
    method: 'POST',
    headers: {
      authorization: credential,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

/**
 * Reads the JSON-RPC payload out of the response.
 *
 * The transport answers a POST with an SSE frame (`event: message\ndata: {...}`)
 * rather than a bare JSON body, so the test parses what a real client parses
 * instead of assuming a shape the server does not send.
 */
async function rpcBody(response: Response) {
  const raw = await response.text()
  const line = raw.split('\n').find((l) => l.startsWith('data: '))
  if (!line) throw new Error(`no data frame in response: ${raw}`)
  return JSON.parse(line.slice('data: '.length))
}

async function post(request: NextRequest) {
  const { POST } = await import('../route')
  return POST(request, { params: Promise.resolve({}) })
}

describe('POST /api/mcp', () => {
  // Restores the environment and clears the config memo around every test, so
  // the per-test setConfigEnv calls below cannot leak into the next file.
  withConfigEnv()

  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    consumeRateLimitMock.mockResolvedValue(ALLOWED)
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    listMessagesMock.mockResolvedValue({
      messages: [],
      nextCursor: null,
      hasMore: false,
    })
  })

  describe('when disabled (the default)', () => {
    it('404s rather than advertising a surface the operator did not enable', async () => {
      setConfigEnv({ ENABLE_MCP: 'false' })
      const response = await post(
        rpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      )
      expect(response.status).toBe(404)
    })

    it('is off when the variable is simply absent', async () => {
      setConfigEnv({ ENABLE_MCP: undefined })
      const response = await post(
        rpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      )
      expect(response.status).toBe(404)
    })
  })

  describe('authentication', () => {
    it('rejects a request with no credential, without a database lookup', async () => {
      setConfigEnv({ ENABLE_MCP: 'true' })
      const request = new NextRequest('http://localhost:4000/api/mcp', {
        method: 'POST',
      })
      const { POST } = await import('../route')

      expect(
        (await POST(request, { params: Promise.resolve({}) })).status,
      ).toBe(401)
      expect(resolveApiKeyPrincipalMock).not.toHaveBeenCalled()
    })

    it('rejects a JWT by prefix, without verifying it', async () => {
      setConfigEnv({ ENABLE_MCP: 'true' })
      const response = await post(
        rpcRequest(
          { jsonrpc: '2.0', id: 1, method: 'tools/list' },
          {},
          'Bearer eyJhbGciOiJIUzI1NiJ9.x.y',
        ),
      )

      expect(response.status).toBe(401)
      expect(resolveApiKeyPrincipalMock).not.toHaveBeenCalled()
    })

    it('rejects a revoked or unknown key', async () => {
      resolveApiKeyPrincipalMock.mockResolvedValue(null)

      setConfigEnv({ ENABLE_MCP: 'true' })
      const response = await post(
        rpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      )
      expect(response.status).toBe(401)
    })

    it('carries the apiKey route tag for the structural guards', async () => {
      const { POST } = await import('../route')
      const { getHandlerTag } = await import('@/lib/auth/route-tags')
      expect(getHandlerTag(POST)).toBe('apiKey')
    })
  })

  describe('origin validation', () => {
    it('serves a request with no Origin header — every supported client sends none', async () => {
      setConfigEnv({ ENABLE_MCP: 'true' })
      const response = await post(
        rpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      )
      expect(response.status).toBe(200)
    })

    it('refuses a browser origin when none is allowlisted', async () => {
      setConfigEnv({ ENABLE_MCP: 'true', MCP_ALLOWED_ORIGINS: undefined })
      const response = await post(
        rpcRequest(
          { jsonrpc: '2.0', id: 1, method: 'tools/list' },
          { origin: 'https://evil.test' },
        ),
      )

      expect(response.status).toBe(403)
      expect(listInboxesMock).not.toHaveBeenCalled()
    })

    it('serves an allowlisted origin', async () => {
      setConfigEnv({
        ENABLE_MCP: 'true',
        MCP_ALLOWED_ORIGINS: 'https://app.example.com',
      })
      const response = await post(
        rpcRequest(
          { jsonrpc: '2.0', id: 1, method: 'tools/list' },
          { origin: 'https://app.example.com' },
        ),
      )

      expect(response.status).toBe(200)
    })
  })

  describe('rate limiting', () => {
    it('buckets on the API key under the mcp scope', async () => {
      setConfigEnv({
        ENABLE_MCP: 'true',
        MCP_RATE_LIMIT_MAX: '7',
        MCP_RATE_LIMIT_WINDOW_S: '30',
      })
      await post(rpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))

      expect(consumeRateLimitMock).toHaveBeenCalledWith('mcp', 'key_1', {
        limit: 7,
        windowMs: 30_000,
      })
    })

    it('429s with Retry-After when the budget is spent', async () => {
      consumeRateLimitMock.mockResolvedValue({
        ...ALLOWED,
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 12,
      })

      setConfigEnv({ ENABLE_MCP: 'true' })
      const response = await post(
        rpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      )

      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('12')
      expect(listInboxesMock).not.toHaveBeenCalled()
    })
  })

  describe('the MCP protocol itself', () => {
    it('lists every tool with its schema and read-only annotations', async () => {
      setConfigEnv({ ENABLE_MCP: 'true' })
      const response = await post(
        rpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      )
      const body = await rpcBody(response)

      const names = body.result.tools.map((t: { name: string }) => t.name)
      expect(names).toEqual([
        'pibx_email_list_inboxes',
        'pibx_email_list_messages',
        'pibx_email_search_messages',
        'pibx_email_get_message',
        'pibx_email_get_thread',
        'pibx_email_get_latest_otp',
      ])

      for (const tool of body.result.tools) {
        expect(tool.annotations.readOnlyHint).toBe(true)
        expect(tool.inputSchema.type).toBe('object')
      }
    })

    it('answers initialize without a session', async () => {
      setConfigEnv({ ENABLE_MCP: 'true' })
      const response = await post(
        rpcRequest({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2026-07-28',
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
          },
        }),
      )

      const body = await rpcBody(response)
      expect(body.result.serverInfo.name).toBe('programmableinbox')
      // The version a client actually receives tracks package.json, rather than
      // a literal that is correct exactly once.
      expect(body.result.serverInfo.version).toBe(packageJson.version)
      expect(response.headers.get('mcp-session-id')).toBeNull()
    })

    it('runs a tool call end to end, scoped to the key organization', async () => {
      listInboxesMock.mockResolvedValue([
        {
          id: 'inbox_1',
          organizationId: 'org_1',
          userId: 'user_1',
          email: 'hello@pibx.dev',
          name: 'Support',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ])

      setConfigEnv({ ENABLE_MCP: 'true' })
      const response = await post(
        rpcRequest({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'pibx_email_list_inboxes', arguments: {} },
        }),
      )

      const body = await rpcBody(response)
      expect(body.result.isError).toBeFalsy()
      expect(listInboxesMock).toHaveBeenCalledWith({
        organizationIds: ['org_1'],
      })

      const payload = JSON.parse(body.result.content[0].text)
      expect(payload.inboxes[0].email).toBe('hello@pibx.dev')
      expect(payload.inboxes[0]).not.toHaveProperty('organizationId')
    })

    it('validates tool arguments against the declared schema', async () => {
      setConfigEnv({ ENABLE_MCP: 'true' })
      const response = await post(
        rpcRequest({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          // inboxId is required and missing.
          params: {
            name: 'pibx_email_search_messages',
            arguments: { q: 'hello' },
          },
        }),
      )

      const body = await rpcBody(response)
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('inboxId')
      expect(listMessagesMock).not.toHaveBeenCalled()
    })

    it('reports a caller-correctable tool failure as isError, not a protocol error', async () => {
      setConfigEnv({ ENABLE_MCP: 'true' })
      const response = await post(
        rpcRequest({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          // No filter supplied — the tool tells the model what to call instead.
          params: {
            name: 'pibx_email_search_messages',
            arguments: { inboxId: 'inbox_1' },
          },
        }),
      )

      const body = await rpcBody(response)
      expect(body.error).toBeUndefined()
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('pibx_email_list_messages')
    })

    it('reserves JSON-RPC errors for requests it cannot process at all', async () => {
      setConfigEnv({ ENABLE_MCP: 'true' })
      const response = await post(
        rpcRequest({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: { name: 'pibx_email_delete_everything', arguments: {} },
        }),
      )

      const body = await rpcBody(response)
      expect(body.result).toBeUndefined()
      expect(body.error.code).toBe(-32602)
    })

    it('enforces per-tool scopes, so a narrow key cannot reach a wider tool', async () => {
      resolveApiKeyPrincipalMock.mockResolvedValue({
        ...KEY,
        scopes: ['inboxes:read'],
      })

      setConfigEnv({ ENABLE_MCP: 'true' })
      const response = await post(
        rpcRequest({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: {
            name: 'pibx_email_list_messages',
            arguments: { inboxId: 'inbox_1' },
          },
        }),
      )

      const body = await rpcBody(response)
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('messages:read')
      expect(listMessagesMock).not.toHaveBeenCalled()
    })
  })
})
