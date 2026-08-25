/**
 * Inbox-creation policy at the route boundary (issue #98).
 *
 * `lib/validation/__tests__/inbox-policy.test.ts` covers the rules themselves.
 * What is asserted here is that the routes actually *run* them, and that they
 * run before anything is written — the whole point of the issue is that a
 * request bypassing the create dialog must be rejected just the same, so the
 * client-side checks are convenience and these are the enforcement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()
const emailInboxCreateMock = vi.fn()
const emailInboxFindFirstMock = vi.fn()
const emailInboxUpdateMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
  SESSION_COOKIE_NAME: 'session',
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      create: (...args: unknown[]) => emailInboxCreateMock(...args),
      findFirst: (...args: unknown[]) => emailInboxFindFirstMock(...args),
      findMany: vi.fn(),
      update: (...args: unknown[]) => emailInboxUpdateMock(...args),
    },
    emailMessage: { updateMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}))

const PRINCIPAL = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  memberships: [{ organizationId: 'org_1', role: 'owner' }],
}

const TOKEN = 'header.payload.signature'

const ROW = {
  id: 'inbox_1',
  organizationId: 'org_1',
  userId: 'user_1',
  email: 'qa@inbox.example.com',
  name: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
  emailInboxFindFirstMock.mockResolvedValue(null)
  emailInboxCreateMock.mockResolvedValue(ROW)
  process.env.EMAIL_INBOX_DOMAINS = 'inbox.example.com,mail.example.com'
})

afterEach(() => {
  delete process.env.EMAIL_INBOX_DOMAINS
})

async function post(body: unknown) {
  const { POST } = await import('../route')
  return POST(
    new NextRequest('http://localhost/api/app/emailInbox', {
      method: 'POST',
      headers: { cookie: `session=${TOKEN}` },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  )
}

async function patch(body: unknown) {
  const { PATCH } = await import('../[id]/route')
  return PATCH(
    new NextRequest('http://localhost/api/app/emailInbox/inbox_1', {
      method: 'PATCH',
      headers: { cookie: `session=${TOKEN}` },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'inbox_1' }) },
  )
}

describe('POST /api/app/emailInbox — domain allowlist', () => {
  it('creates an inbox at a configured domain', async () => {
    const response = await post({
      organizationId: 'org_1',
      email: 'qa@inbox.example.com',
    })

    expect(response.status).toBe(201)
    expect(emailInboxCreateMock).toHaveBeenCalled()
  })

  it('creates at the second configured domain too, not just the first', async () => {
    const response = await post({
      organizationId: 'org_1',
      email: 'qa@mail.example.com',
    })

    expect(response.status).toBe(201)
  })

  it('400s an address at an unconfigured domain and writes nothing', async () => {
    const response = await post({ organizationId: 'org_1', email: 'qa@gmail.com' })

    expect(response.status).toBe(400)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('names the allowed domains so the caller can correct the request', async () => {
    const response = await post({ organizationId: 'org_1', email: 'qa@gmail.com' })

    expect((await response.json()).message).toContain('inbox.example.com')
  })

  it('rejects a subdomain of a configured domain', async () => {
    const response = await post({
      organizationId: 'org_1',
      email: 'qa@evil.inbox.example.com',
    })

    expect(response.status).toBe(400)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  /**
   * EMAIL_INBOX_DOMAINS is required and asserted at boot, so an unconfigured
   * server never reaches this handler. What must still hold is that the route
   * refuses rather than defaulting to "any domain" — a 500 from the config
   * layer is an acceptable answer here; a 201 is not.
   */
  it('never falls back to allowing any domain when unconfigured', async () => {
    delete process.env.EMAIL_INBOX_DOMAINS

    const response = await post({ organizationId: 'org_1', email: 'qa@gmail.com' })

    expect(response.status).not.toBe(201)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/app/emailInbox — impersonation blocklist', () => {
  it.each([
    ['amazon-security', 'embedded brand'],
    ['g-o-o-g-l-e', 'separator evasion'],
    ['g00gle', 'leetspeak'],
    ['pi-support', 'platform self-impersonation'],
    ['billing', 'staff-sounding term'],
  ])('422s %s (%s) and writes nothing', async (localPart) => {
    const response = await post({
      organizationId: 'org_1',
      email: `${localPart}@inbox.example.com`,
    })

    expect(response.status).toBe(422)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a blocked display name even when the address is fine', async () => {
    const response = await post({
      organizationId: 'org_1',
      email: 'qa@inbox.example.com',
      name: 'Amazon Support',
    })

    expect(response.status).toBe(422)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a Cyrillic homoglyph display name, which the term list alone misses', async () => {
    const response = await post({
      organizationId: 'org_1',
      email: 'qa@inbox.example.com',
      name: 'Аmazon',
    })

    expect(response.status).toBe(422)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('does not echo the blocked term back to the caller', async () => {
    const response = await post({
      organizationId: 'org_1',
      email: 'amazon@inbox.example.com',
    })

    expect((await response.json()).message).not.toMatch(/amazon/i)
  })

  it('still allows an ordinary display name', async () => {
    const response = await post({
      organizationId: 'org_1',
      email: 'qa@inbox.example.com',
      name: 'QA Team',
    })

    expect(response.status).toBe(201)
  })
})

describe('POST /api/app/emailInbox — length caps', () => {
  it('400s a local part past 50 characters and writes nothing', async () => {
    const response = await post({
      organizationId: 'org_1',
      email: `${'a'.repeat(51)}@inbox.example.com`,
    })

    expect(response.status).toBe(400)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('creates at exactly 50 characters', async () => {
    const response = await post({
      organizationId: 'org_1',
      email: `${'a'.repeat(50)}@inbox.example.com`,
    })

    expect(response.status).toBe(201)
  })

  it('400s a display name past 100 characters and writes nothing', async () => {
    const response = await post({
      organizationId: 'org_1',
      email: 'qa@inbox.example.com',
      name: 'a'.repeat(101),
    })

    expect(response.status).toBe(400)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('creates with a display name at exactly 100 characters', async () => {
    const response = await post({
      organizationId: 'org_1',
      email: 'qa@inbox.example.com',
      name: 'a'.repeat(100),
    })

    expect(response.status).toBe(201)
  })
})

describe('PATCH /api/app/emailInbox/[id] — rename policy', () => {
  beforeEach(() => {
    emailInboxFindFirstMock.mockResolvedValue(ROW)
    emailInboxUpdateMock.mockResolvedValue({ ...ROW, name: 'QA Team' })
  })

  it('allows an ordinary rename', async () => {
    const response = await patch({ name: 'QA Team' })

    expect(response.status).toBe(200)
  })

  it('422s a rename to a blocked brand — the create-only check was the hole', async () => {
    // The exact escape the blocklist would otherwise have: create as `qa`,
    // then rename to something that reads as a brand.
    const response = await patch({ name: 'Amazon Support' })

    expect(response.status).toBe(422)
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })

  it('422s a rename to a leetspeak brand', async () => {
    const response = await patch({ name: 'Paypa1' })

    expect(response.status).toBe(422)
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })

  it('422s a rename to a Cyrillic homoglyph', async () => {
    const response = await patch({ name: 'Аmazon' })

    expect(response.status).toBe(422)
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })

  it('400s a rename past 100 characters — the cap is not create-only either', async () => {
    const response = await patch({ name: 'a'.repeat(101) })

    expect(response.status).toBe(400)
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })

  it('404s a non-owner before judging the name, so the policy is not an existence oracle', async () => {
    emailInboxFindFirstMock.mockResolvedValue(null)

    const response = await patch({ name: 'Amazon Support' })

    expect(response.status).toBe(404)
  })
})
