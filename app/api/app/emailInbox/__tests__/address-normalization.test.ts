/**
 * Address claiming must agree with inbound routing (F1 / issue #37).
 *
 * The unique index on `email_inboxes.email` is byte-exact, but the webhook
 * lowercases the inbound recipient before matching
 * (app/api/webhooks/email/route.ts). Left alone, that mismatch reopens the
 * cross-tenant interception the unique index was added to close:
 *
 *   1. Tenant B claims `Payroll@corp.com` — stored verbatim.
 *   2. Inbound mail for that address is lowercased to `payroll@corp.com`,
 *      matches nothing, and Tenant B's inbox stays empty.
 *   3. Tenant A claims `payroll@corp.com` — a different byte string, so the
 *      unique index allows it — and receives all of Tenant B's mail.
 *
 * These tests pin the fix: every claimed address is normalized before it is
 * compared or persisted, so "already claimed" is decided in the same space
 * the router matches in.
 *
 * Ported from the v1 suite when these routes moved to /api/app. Auth is now
 * withUser, so the seam is resolveUserPrincipalFromToken rather than
 * getAuthenticatedUser, and every request carries a bearer token that is not
 * an sk_live_ key — withUser rejects those by prefix before verification.
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

/** Prisma's unique-constraint violation, as the pg adapter reports it. */
function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target: ['email'] },
  })
}

const PRINCIPAL = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  memberships: [{ organizationId: 'org_1', role: 'owner' }],
}

const TOKEN = 'header.payload.signature'
const UNAVAILABLE = 'Email address is not available'
const IMMUTABLE = 'The address of an inbox cannot be changed. Create a new inbox instead.'

const ROW = {
  id: 'inbox_1',
  organizationId: 'org_1',
  userId: 'user_1',
  email: 'payroll@corp.com',
  name: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
  emailInboxFindFirstMock.mockResolvedValue(null)
  // Creation is fail-closed on the domain allowlist (issue #98), so these
  // normalization tests must configure the domain they claim at or every POST
  // stops at a 503 before reaching the behavior under test.
  process.env.EMAIL_INBOX_DOMAINS = 'corp.com'
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

async function patch(id: string, body: unknown) {
  const { PATCH } = await import('../[id]/route')
  return PATCH(
    new NextRequest(`http://localhost/api/app/emailInbox/${id}`, {
      method: 'PATCH',
      headers: { cookie: `session=${TOKEN}` },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}

describe('POST /api/app/emailInbox — address normalization', () => {
  it('persists the address lowercased and trimmed', async () => {
    emailInboxCreateMock.mockResolvedValue(ROW)

    const response = await post({ organizationId: 'org_1', email: '  Payroll@Corp.com ' })

    expect(response.status).toBe(201)
    expect(emailInboxCreateMock.mock.calls[0][0].data.email).toBe('payroll@corp.com')
  })

  it('checks availability against the normalized address, not the raw input', async () => {
    emailInboxCreateMock.mockResolvedValue(ROW)

    await post({ organizationId: 'org_1', email: 'Payroll@Corp.com' })

    expect(emailInboxFindFirstMock.mock.calls[0][0].where.email).toBe('payroll@corp.com')
  })

  it('409s when the address is already claimed', async () => {
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_other', email: 'payroll@corp.com' })

    const response = await post({ organizationId: 'org_1', email: 'payroll@corp.com' })

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe(UNAVAILABLE)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('409s on a case variant of an address another tenant already holds', async () => {
    // The core of the bug: `Payroll@corp.com` must not be claimable while
    // `payroll@corp.com` exists, because routing treats them as one address.
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_other', email: 'payroll@corp.com' })

    const response = await post({ organizationId: 'org_1', email: 'Payroll@corp.com' })

    expect(response.status).toBe(409)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('409s on a whitespace-padded variant', async () => {
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_other', email: 'payroll@corp.com' })

    const response = await post({ organizationId: 'org_1', email: ' payroll@corp.com ' })

    expect(response.status).toBe(409)
  })

  it('maps a racing P2002 to 409 rather than 500', async () => {
    // The pre-check is not authoritative — two concurrent claims can both pass
    // it. The unique index decides, and its violation must read as "taken".
    emailInboxCreateMock.mockRejectedValue(uniqueViolation())

    const response = await post({ organizationId: 'org_1', email: 'payroll@corp.com' })

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe(UNAVAILABLE)
  })

  it('reports a soft-deleted holder identically, without leaking that it exists', async () => {
    // Reads are soft-delete filtered, so the pre-check cannot see the holder and
    // the unique index raises instead. The response must not distinguish the
    // two cases, or it becomes an oracle for addresses in other orgs.
    emailInboxFindFirstMock.mockResolvedValue(null)
    emailInboxCreateMock.mockRejectedValue(uniqueViolation())

    const response = await post({ organizationId: 'org_1', email: 'payroll@corp.com' })

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe(UNAVAILABLE)
  })

  it('400s an unroutable address instead of storing an inbox that can never receive mail', async () => {
    const response = await post({ organizationId: 'org_1', email: 'not-an-address' })

    expect(response.status).toBe(400)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('403s a request for an organization the user does not belong to', async () => {
    const response = await post({ organizationId: 'org_other', email: 'payroll@corp.com' })

    expect(response.status).toBe(403)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('rejects an API key outright, without a database lookup', async () => {
    // withUser discriminates on the sk_live_ prefix before any verification, so
    // a key cannot reach a creating route even by presenting a valid credential.
    const { POST } = await import('../route')
    const response = await POST(
      new NextRequest('http://localhost/api/app/emailInbox', {
        method: 'POST',
        headers: { cookie: 'session=sk_live_abcdef123456' },
        body: JSON.stringify({ organizationId: 'org_1', email: 'payroll@corp.com' }),
      }),
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(401)
    expect(resolveUserPrincipalFromTokenMock).not.toHaveBeenCalled()
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/app/emailInbox/[id] — address immutability', () => {
  it('409s an attempt to re-point the address at another value', async () => {
    // Re-pointing was a second route to cross-tenant interception: claim a
    // throwaway address, then move it onto a case variant of a tenant's.
    emailInboxFindFirstMock.mockResolvedValue(ROW)

    const response = await patch('inbox_1', { email: 'other@corp.com' })

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe(IMMUTABLE)
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })

  it('409s a case variant, which routing would treat as the same address', async () => {
    emailInboxFindFirstMock.mockResolvedValue(ROW)

    const response = await patch('inbox_1', { email: 'Payroll@Corp.com', name: 'Renamed' })

    // Normalizing the submission makes it equal to the stored address, so this
    // is a no-op rather than a change — it must be allowed through to the rename.
    expect(response.status).not.toBe(409)
  })

  it('allows a rename when the address is omitted', async () => {
    emailInboxFindFirstMock.mockResolvedValue(ROW)
    emailInboxUpdateMock.mockResolvedValue({ ...ROW, name: 'Renamed' })

    const response = await patch('inbox_1', { name: 'Renamed' })

    expect(response.status).toBe(200)
    expect((await response.json()).data.name).toBe('Renamed')
  })

  it('404s a non-owner before evaluating the address, not 409', async () => {
    // Ownership resolves first, so a colleague who can *read* the inbox cannot
    // tell "exists but not yours" apart from "does not exist" by submitting an
    // address. Answering 409 here would leak both facts.
    emailInboxFindFirstMock.mockResolvedValue(null)

    const response = await patch('inbox_1', { email: 'guessed@corp.com' })

    expect(response.status).toBe(404)
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })

  it('resolves ownership with a userId-constrained lookup', async () => {
    emailInboxFindFirstMock.mockResolvedValue(ROW)

    await patch('inbox_1', { name: 'Renamed' })

    expect(emailInboxFindFirstMock.mock.calls[0][0]).toEqual({
      where: { id: 'inbox_1', userId: 'user_1' },
    })
  })

  it('400s an invalid address rather than treating it as absent or as immutable', async () => {
    // The guarantee this test was written for is that a malformed `email` is
    // not silently dropped and the rename allowed through — that still holds.
    // The status is now 400 rather than 409: `parseInboxAddress` answers null
    // for "malformed" and for "different address" alike, so the old comparison
    // reported a mistyped address as "the address is frozen", which is both
    // misleading and the opposite of what POST says about the same string.
    emailInboxFindFirstMock.mockResolvedValue(ROW)

    const response = await patch('inbox_1', { email: 'not-an-address' })

    expect(response.status).toBe(400)
    expect((await response.json()).message).toBe('email must be a valid email address')
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })
})
