import { beforeEach, describe, expect, it, vi } from 'vitest'

const listInboxesMock = vi.fn()
const listMessagesMock = vi.fn()
const getMessageMock = vi.fn()
const createInboxMock = vi.fn()
const updateInboxForWriteMock = vi.fn()

vi.mock('@/lib/services/email-inbox', () => ({
  listInboxes: (...a: unknown[]) => listInboxesMock(...a),
  listMessages: (...a: unknown[]) => listMessagesMock(...a),
  getMessage: (...a: unknown[]) => getMessageMock(...a),
  createInbox: (...a: unknown[]) => createInboxMock(...a),
  updateInboxForWrite: (...a: unknown[]) => updateInboxForWriteMock(...a),
}))

import { EMAIL_TOOLS } from '../tools'
import type { ApiKeyPrincipal } from '@/lib/auth/principals'

const KEY: ApiKeyPrincipal = {
  kind: 'apiKey',
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  userId: 'user_1',
  scopes: ['email_inboxes:read', 'email_messages:read', 'email_inboxes:write'],
}

const ORG_SCOPE = { organizationIds: ['org_1'] }

const NEW_ADDRESS = 'new@mail.programmableinbox.com'

const INBOX_ROW = {
  id: 'inbox_1',
  organizationId: 'org_1',
  userId: 'user_1',
  email: NEW_ADDRESS,
  name: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
}

function tool(name: string) {
  const found = EMAIL_TOOLS.find((t) => t.name === name)
  if (!found) throw new Error(`no tool named ${name}`)
  return found
}

/**
 * The JSON Schema a client actually receives in `tools/list`.
 *
 * Read back out of the Standard Schema wrapper rather than from the literal in
 * the source, so these assertions cover what `fromJsonSchema` publishes — the
 * thing the model sees — and not a copy of the input that could diverge from it.
 */
function jsonSchemaOf(name: string): {
  type?: string
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
} {
  const schema = tool(name).config.inputSchema as unknown as {
    '~standard': {
      jsonSchema: { input: (options: { target: string }) => Record<string, unknown> }
    }
  }
  return schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as ReturnType<
    typeof jsonSchemaOf
  >
}

async function call(name: string, args: unknown, principal: ApiKeyPrincipal = KEY) {
  return tool(name).run(args as never, principal)
}

/** Parses the JSON payload out of a successful tool result. */
function payload(result: { content: Array<{ text: string }>; isError?: boolean }) {
  expect(result.isError).toBeFalsy()
  return JSON.parse(result.content[0].text)
}

function text(result: { content: Array<{ text: string }> }) {
  return result.content[0].text
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    threadId: 'thread_1',
    subject: 'Your verification code',
    from: 'noreply@stripe.com',
    to: ['hello@pibx.dev'],
    cc: [],
    text: 'plain',
    html: '<style>.x{}</style><b>hi</b>',
    bodyText: 'Your code is 123456',
    isStarred: false,
    tags: [],
    categories: [],
    extractedOtp: null,
    createdAt: new Date('2026-03-01T12:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  listMessagesMock.mockResolvedValue({ messages: [], nextCursor: null, hasMore: false })
})

describe('tool surface', () => {
  it('exposes exactly the six documented tools, all pibx_email_ prefixed', () => {
    expect(EMAIL_TOOLS.map((t) => t.name)).toEqual([
      'pibx_email_list_inboxes',
      'pibx_email_list_messages',
      'pibx_email_search_messages',
      'pibx_email_get_message',
      'pibx_email_get_thread',
      'pibx_email_get_latest_otp',
      'pibx_email_create_inbox',
      'pibx_email_update_inbox',
    ])
  })

  it('annotates every read tool read-only — the spec defaults are destructive and open-world', () => {
    for (const t of EMAIL_TOOLS) {
      if (t.scope === 'email_inboxes:write') continue
      expect(t.config.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      })
    }
  })

  it('does not advertise a write tool as read-only', () => {
    // Clients gate confirmation prompts on these. A mutation announcing itself
    // as read-only is silently exempted from the prompt a user would want.
    for (const name of ['pibx_email_create_inbox', 'pibx_email_update_inbox']) {
      expect(tool(name).config.annotations).toMatchObject({
        readOnlyHint: false,
        // Neither creating nor renaming destroys anything. Deletion is the
        // destructive operation, and it is deliberately not exposed here.
        destructiveHint: false,
        openWorldHint: false,
      })
    }
  })

  it('marks create as non-idempotent and update as idempotent', () => {
    // Calling create twice claims two addresses; calling update twice with the
    // same name is a no-op. A client retrying on timeout needs the difference.
    expect(tool('pibx_email_create_inbox').config.annotations).toMatchObject({
      idempotentHint: false,
    })
    expect(tool('pibx_email_update_inbox').config.annotations).toMatchObject({
      idempotentHint: true,
    })
  })

  it('declares no root-level anyOf/oneOf/allOf — the Claude API rejects those', () => {
    for (const t of EMAIL_TOOLS) {
      const json = jsonSchemaOf(t.name)
      expect(json).not.toHaveProperty('anyOf')
      expect(json).not.toHaveProperty('oneOf')
      expect(json).not.toHaveProperty('allOf')
      expect(json.type).toBe('object')
    }
  })

  it('gives every tool a description — it is the only thing the model reads', () => {
    for (const t of EMAIL_TOOLS) {
      expect(typeof t.config.description).toBe('string')
      expect((t.config.description as string).length).toBeGreaterThan(40)
    }
  })

  it('does not expose grouped on the search tool — the combination is a 400', () => {
    // The invalid state is unrepresentable in the schema rather than caught at
    // runtime: a model cannot ask for grouped+search because there is no field.
    expect(jsonSchemaOf('pibx_email_search_messages').properties).not.toHaveProperty('grouped')
    // ...while the plain listing tool does offer it.
    expect(jsonSchemaOf('pibx_email_list_messages').properties).toHaveProperty('grouped')
  })

  it('requires inboxId on every tool that reads one', () => {
    for (const name of [
      'pibx_email_list_messages',
      'pibx_email_search_messages',
      'pibx_email_get_message',
      'pibx_email_get_thread',
      'pibx_email_get_latest_otp',
    ]) {
      expect(jsonSchemaOf(name).required).toContain('inboxId')
    }
  })

  it('rejects unknown arguments rather than silently ignoring them', () => {
    for (const t of EMAIL_TOOLS) {
      expect(jsonSchemaOf(t.name).additionalProperties).toBe(false)
    }
  })
})

describe('scope enforcement', () => {
  it('refuses a tool whose scope the key lacks, without touching the service', async () => {
    const noMessages: ApiKeyPrincipal = { ...KEY, scopes: ['email_inboxes:read'] }

    const result = await call('pibx_email_list_messages', { inboxId: 'inbox_1' }, noMessages)

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('email_messages:read')
    expect(listMessagesMock).not.toHaveBeenCalled()
  })

  it('refuses list_inboxes without email_inboxes:read', async () => {
    const noInboxes: ApiKeyPrincipal = { ...KEY, scopes: ['email_messages:read'] }

    const result = await call('pibx_email_list_inboxes', {}, noInboxes)

    expect(result.isError).toBe(true)
    expect(listInboxesMock).not.toHaveBeenCalled()
  })

  it('accepts a key still holding a pre-rename scope', async () => {
    const unmigrated: ApiKeyPrincipal = { ...KEY, scopes: ['inboxes:read'] }
    listInboxesMock.mockResolvedValue([])

    const result = await call('pibx_email_list_inboxes', {}, unmigrated)

    expect(result.isError).toBeFalsy()
    expect(listInboxesMock).toHaveBeenCalledWith(ORG_SCOPE)
  })

  it('names the current scope when an un-migrated key lacks one', async () => {
    const unmigrated: ApiKeyPrincipal = { ...KEY, scopes: ['inboxes:read'] }

    const result = await call('pibx_email_list_messages', { inboxId: 'inbox_1' }, unmigrated)

    expect(text(result)).toContain('email_messages:read')
    expect(text(result)).not.toContain('"messages:read"')
  })

  it('passes only an organization scope to the service, never the principal', async () => {
    listInboxesMock.mockResolvedValue([])
    await call('pibx_email_list_inboxes', {})
    expect(listInboxesMock).toHaveBeenCalledWith(ORG_SCOPE)
  })
})

describe('pibx_email_list_inboxes', () => {
  it('serializes through the MCP allowlist', async () => {
    listInboxesMock.mockResolvedValue([
      {
        id: 'inbox_1',
        organizationId: 'org_1',
        userId: 'user_1',
        email: 'hello@pibx.dev',
        name: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    const result = payload(await call('pibx_email_list_inboxes', {}))

    expect(result.inboxes).toEqual([
      { id: 'inbox_1', email: 'hello@pibx.dev', name: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ])
  })
})

describe('pibx_email_list_messages', () => {
  it('lists with the defaults and never searches', async () => {
    listMessagesMock.mockResolvedValue({
      messages: [row()],
      nextCursor: 'cursor_2',
      hasMore: true,
    })

    const result = payload(await call('pibx_email_list_messages', { inboxId: 'inbox_1' }))

    expect(listMessagesMock).toHaveBeenCalledWith(ORG_SCOPE, 'inbox_1', {
      limit: 50,
      cursor: null,
      threadId: null,
      grouped: false,
      search: null,
    })
    expect(result.nextCursor).toBe('cursor_2')
    expect(result.hasMore).toBe(true)
    expect(result.messages[0].snippet).toBe('Your code is 123456')
  })

  it('returns concise rows by default and full bodies only on request', async () => {
    listMessagesMock.mockResolvedValue({
      messages: [row({ bodyText: 'x'.repeat(600) })],
      nextCursor: null,
      hasMore: false,
    })

    const concise = payload(await call('pibx_email_list_messages', { inboxId: 'inbox_1' }))
    expect(concise.messages[0]).toHaveProperty('snippet')
    expect(concise.messages[0]).not.toHaveProperty('body')

    const detailed = payload(
      await call('pibx_email_list_messages', {
        inboxId: 'inbox_1',
        response_format: 'detailed',
      }),
    )
    expect(detailed.messages[0]).toHaveProperty('body')
    expect(detailed.messages[0]).not.toHaveProperty('snippet')
  })

  it('clamps an out-of-range limit rather than passing it through', async () => {
    await call('pibx_email_list_messages', { inboxId: 'inbox_1', limit: 5000 })
    expect(listMessagesMock.mock.calls[0][2].limit).toBe(100)
  })

  it('passes grouped and threadId through', async () => {
    await call('pibx_email_list_messages', {
      inboxId: 'inbox_1',
      grouped: true,
      threadId: 'thread_9',
    })

    expect(listMessagesMock.mock.calls[0][2]).toMatchObject({
      grouped: true,
      threadId: 'thread_9',
    })
  })

  it('reports a bad cursor as a correctable error, not a crash', async () => {
    const result = await call('pibx_email_list_messages', {
      inboxId: 'inbox_1',
      cursor: 'not-a-cursor!!',
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('nextCursor')
    expect(listMessagesMock).not.toHaveBeenCalled()
  })

  it('reports an inbox it cannot see without revealing whether it exists', async () => {
    listMessagesMock.mockResolvedValue(null)

    const result = await call('pibx_email_list_messages', { inboxId: 'inbox_other' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('pibx_email_list_inboxes')
    expect(text(result)).not.toMatch(/exists|another organization|forbidden/i)
  })
})

describe('pibx_email_search_messages', () => {
  it('routes every filter through the shared parser and never groups', async () => {
    await call('pibx_email_search_messages', {
      inboxId: 'inbox_1',
      q: 'invoice',
      from: 'stripe.com',
      tags: ['billing', 'urgent'],
      categories: ['finance'],
    })

    expect(listMessagesMock).toHaveBeenCalledWith(ORG_SCOPE, 'inbox_1', {
      limit: 50,
      cursor: null,
      threadId: null,
      grouped: false,
      search: {
        q: 'invoice',
        from: 'stripe.com',
        tags: ['billing', 'urgent'],
        categories: ['finance'],
      },
    })
  })

  it('accepts a single filter on its own', async () => {
    await call('pibx_email_search_messages', { inboxId: 'inbox_1', q: 'receipt' })

    expect(listMessagesMock.mock.calls[0][2].search).toEqual({
      q: 'receipt',
      from: null,
      tags: [],
      categories: [],
    })
  })

  it('directs a caller who supplied no filter to the listing tool', async () => {
    const result = await call('pibx_email_search_messages', { inboxId: 'inbox_1' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('pibx_email_list_messages')
    expect(listMessagesMock).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only query as no filter at all', async () => {
    const result = await call('pibx_email_search_messages', { inboxId: 'inbox_1', q: '   ' })

    expect(result.isError).toBe(true)
    expect(listMessagesMock).not.toHaveBeenCalled()
  })

  it('enforces the parser cap on query length', async () => {
    const result = await call('pibx_email_search_messages', {
      inboxId: 'inbox_1',
      q: 'x'.repeat(201),
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('200 characters')
    expect(listMessagesMock).not.toHaveBeenCalled()
  })

  it('enforces the parser cap on filter value count', async () => {
    const result = await call('pibx_email_search_messages', {
      inboxId: 'inbox_1',
      tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('at most 20 values')
  })

  it('searches within a thread — that combination is legal', async () => {
    await call('pibx_email_search_messages', {
      inboxId: 'inbox_1',
      q: 'refund',
      threadId: 'thread_3',
    })

    expect(listMessagesMock.mock.calls[0][2]).toMatchObject({
      threadId: 'thread_3',
      grouped: false,
    })
  })

  it('keeps the same cursor contract as the listing tool', async () => {
    listMessagesMock.mockResolvedValue({
      messages: [],
      nextCursor: 'next_page',
      hasMore: true,
    })

    const result = payload(
      await call('pibx_email_search_messages', { inboxId: 'inbox_1', q: 'a' }),
    )

    expect(result.nextCursor).toBe('next_page')
    expect(result.hasMore).toBe(true)
  })
})

describe('pibx_email_get_message', () => {
  it('returns the full body and never html', async () => {
    getMessageMock.mockResolvedValue(row({ bodyText: 'the whole body' }))

    const result = payload(await call('pibx_email_get_message', {
      inboxId: 'inbox_1',
      messageId: 'msg_1',
    }))

    expect(getMessageMock).toHaveBeenCalledWith(ORG_SCOPE, 'inbox_1', 'msg_1')
    expect(result.message.body).toBe('the whole body')
    expect(JSON.stringify(result)).not.toContain('<style>')
  })

  it('reports a missing message as a correctable error', async () => {
    getMessageMock.mockResolvedValue(null)

    const result = await call('pibx_email_get_message', {
      inboxId: 'inbox_1',
      messageId: 'nope',
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('nope')
  })
})

describe('pibx_email_get_thread', () => {
  it('asks the service for one thread, which orders it oldest first', async () => {
    listMessagesMock.mockResolvedValue({ messages: [row()], nextCursor: null, hasMore: false })

    await call('pibx_email_get_thread', { inboxId: 'inbox_1', threadId: 'thread_1' })

    expect(listMessagesMock).toHaveBeenCalledWith(ORG_SCOPE, 'inbox_1', {
      limit: 50,
      cursor: null,
      threadId: 'thread_1',
      grouped: false,
      search: null,
    })
  })
})

describe('pibx_email_get_latest_otp', () => {
  const now = new Date('2026-03-01T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  it('returns the newest code inside the freshness window', async () => {
    listMessagesMock.mockResolvedValue({
      messages: [
        row({ id: 'msg_new', extractedOtp: '999111', createdAt: new Date(now.getTime() - 60_000) }),
        row({ id: 'msg_old', extractedOtp: '111222', createdAt: new Date(now.getTime() - 120_000) }),
      ],
      nextCursor: null,
      hasMore: false,
    })

    const result = payload(await call('pibx_email_get_latest_otp', { inboxId: 'inbox_1' }))

    expect(result.otp).toBe('999111')
    expect(result.message.id).toBe('msg_new')
  })

  it('skips messages with no code', async () => {
    listMessagesMock.mockResolvedValue({
      messages: [
        row({ id: 'no_code', extractedOtp: null }),
        row({ id: 'has_code', extractedOtp: '424242' }),
      ],
      nextCursor: null,
      hasMore: false,
    })

    expect(payload(await call('pibx_email_get_latest_otp', { inboxId: 'inbox_1' })).otp).toBe(
      '424242',
    )
  })

  it('refuses a stale code and says so distinctly from finding none', async () => {
    listMessagesMock.mockResolvedValue({
      messages: [
        row({ extractedOtp: '123456', createdAt: new Date(now.getTime() - 60 * 60_000) }),
      ],
      nextCursor: null,
      hasMore: false,
    })

    const stale = payload(await call('pibx_email_get_latest_otp', { inboxId: 'inbox_1' }))
    expect(stale.otp).toBeNull()
    expect(stale.reason).toContain('older than 15 minutes')

    listMessagesMock.mockResolvedValue({ messages: [], nextCursor: null, hasMore: false })
    const none = payload(await call('pibx_email_get_latest_otp', { inboxId: 'inbox_1' }))
    expect(none.otp).toBeNull()
    expect(none.reason).toContain('wait and call again')
  })

  it('honours a widened window', async () => {
    listMessagesMock.mockResolvedValue({
      messages: [
        row({ extractedOtp: '123456', createdAt: new Date(now.getTime() - 30 * 60_000) }),
      ],
      nextCursor: null,
      hasMore: false,
    })

    expect(
      payload(await call('pibx_email_get_latest_otp', { inboxId: 'inbox_1', withinMinutes: 60 }))
        .otp,
    ).toBe('123456')
  })

  it('applies a sender filter through the shared search parser', async () => {
    await call('pibx_email_get_latest_otp', { inboxId: 'inbox_1', from: 'stripe.com' })

    expect(listMessagesMock.mock.calls[0][2].search).toEqual({
      q: null,
      from: 'stripe.com',
      tags: [],
      categories: [],
    })
  })

  it('does not search when no sender filter was given', async () => {
    await call('pibx_email_get_latest_otp', { inboxId: 'inbox_1' })
    expect(listMessagesMock.mock.calls[0][2].search).toBeNull()
  })
})

describe('pibx_email_create_inbox', () => {
  it('refuses a key without the write scope, without touching the service', async () => {
    const readOnly: ApiKeyPrincipal = {
      ...KEY,
      scopes: ['email_inboxes:read', 'email_messages:read'],
    }

    const result = await call('pibx_email_create_inbox', { email: NEW_ADDRESS }, readOnly)

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('email_inboxes:write')
    expect(createInboxMock).not.toHaveBeenCalled()
  })

  it('does not let a legacy read scope reach it', async () => {
    // The alias table is read-only on purpose: a rename must not be a
    // privilege grant.
    const unmigrated: ApiKeyPrincipal = { ...KEY, scopes: ['inboxes:read', 'messages:read'] }

    const result = await call('pibx_email_create_inbox', { email: NEW_ADDRESS }, unmigrated)

    expect(result.isError).toBe(true)
    expect(createInboxMock).not.toHaveBeenCalled()
  })

  it('creates through the shared service, bound to the key organization', async () => {
    createInboxMock.mockResolvedValue({ inbox: INBOX_ROW })

    const result = await call('pibx_email_create_inbox', { email: NEW_ADDRESS, name: 'QA' })

    expect(result.isError).toBeFalsy()
    expect(createInboxMock).toHaveBeenCalledWith(
      { organizationId: 'org_1', userId: 'user_1' },
      { email: NEW_ADDRESS, name: 'QA' },
    )
  })

  it('returns the inbox in the same shape the listing tool returns', async () => {
    // So an agent can feed the result straight back in as an inboxId without
    // learning a second shape.
    createInboxMock.mockResolvedValue({ inbox: INBOX_ROW })

    const result = await call('pibx_email_create_inbox', { email: NEW_ADDRESS })

    expect(payload(result).inbox).toEqual({
      id: 'inbox_1',
      email: NEW_ADDRESS,
      name: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('reports a policy rejection as correctable text, not a crash', async () => {
    createInboxMock.mockResolvedValue({
      error: { message: 'Email address is not available', status: 409 },
    })

    const result = await call('pibx_email_create_inbox', { email: NEW_ADDRESS })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Email address is not available')
  })
})

describe('pibx_email_update_inbox', () => {
  it('refuses a key without the write scope', async () => {
    const readOnly: ApiKeyPrincipal = { ...KEY, scopes: ['email_inboxes:read'] }

    const result = await call(
      'pibx_email_update_inbox',
      { inboxId: 'inbox_1', name: 'QA' },
      readOnly,
    )

    expect(result.isError).toBe(true)
    expect(updateInboxForWriteMock).not.toHaveBeenCalled()
  })

  it('renames through the shared service', async () => {
    updateInboxForWriteMock.mockResolvedValue({ inbox: { ...INBOX_ROW, name: 'QA' } })

    const result = await call('pibx_email_update_inbox', { inboxId: 'inbox_1', name: 'QA' })

    expect(result.isError).toBeFalsy()
    expect(updateInboxForWriteMock).toHaveBeenCalledWith(
      { organizationId: 'org_1', userId: 'user_1' },
      'inbox_1',
      { name: 'QA' },
    )
  })

  it('takes no email argument at all — the address is immutable', () => {
    // Accepting one and rejecting it in the handler would advertise a
    // capability that does not exist, which a model will keep retrying.
    const json = jsonSchemaOf('pibx_email_update_inbox')
    expect(json.properties).not.toHaveProperty('email')
  })

  it('reports an inbox it cannot reach as correctable text', async () => {
    updateInboxForWriteMock.mockResolvedValue({ error: { message: 'Not found', status: 404 } })

    const result = await call('pibx_email_update_inbox', { inboxId: 'inbox_1', name: 'QA' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('inbox_1')
  })
})
