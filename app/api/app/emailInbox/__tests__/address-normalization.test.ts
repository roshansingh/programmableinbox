/**
 * Address claiming must agree with inbound routing (F1 / issue #37).
 *
 * The unique index on `email_inboxes.email` is byte-exact, but the webhook
 * lowercases the inbound recipient before matching
 * (app/api/webhooks/email/route.ts). Left alone, that mismatch reopens the
 * cross-tenant interception the unique index was added to close:
 *
 *   1. Tenant B claims `Billing@corp.com` — stored verbatim.
 *   2. Inbound mail for that address is lowercased to `billing@corp.com`,
 *      matches nothing, and Tenant B's inbox stays empty.
 *   3. Tenant A claims `billing@corp.com` — a different byte string, so the
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
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()
const emailInboxCreateMock = vi.fn()
const emailInboxFindFirstMock = vi.fn()
const emailInboxUpdateMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
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

const TOKEN = 'Bearer header.payload.signature'
const UNAVAILABLE = 'Email address is not available'
const IMMUTABLE = 'The address of an inbox cannot be changed. Create a new inbox instead.'

const ROW = {
  id: 'inbox_1',
  organizationId: 'org_1',
  userId: 'user_1',
  email: 'billing@corp.com',
  name: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
  emailInboxFindFirstMock.mockResolvedValue(null)
})

async function post(body: unknown) {
  const { POST } = await import('../route')
  return POST(
    new NextRequest('http://localhost/api/app/emailInbox', {
      method: 'POST',
      headers: { authorization: TOKEN },
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
      headers: { authorization: TOKEN },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}

describe('POST /api/app/emailInbox — address normalization', () => {
  it('persists the address lowercased and trimmed', async () => {
    emailInboxCreateMock.mockResolvedValue(ROW)

    const response = await post({ organizationId: 'org_1', email: '  Billing@Corp.com ' })

    expect(response.status).toBe(201)
    expect(emailInboxCreateMock.mock.calls[0][0].data.email).toBe('billing@corp.com')
  })

  it('checks availability against the normalized address, not the raw input', async () => {
    emailInboxCreateMock.mockResolvedValue(ROW)

    await post({ organizationId: 'org_1', email: 'Billing@Corp.com' })

    expect(emailInboxFindFirstMock.mock.calls[0][0].where.email).toBe('billing@corp.com')
  })

  it('409s when the address is already claimed', async () => {
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_other', email: 'billing@corp.com' })

    const response = await post({ organizationId: 'org_1', email: 'billing@corp.com' })

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe(UNAVAILABLE)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('409s on a case variant of an address another tenant already holds', async () => {
    // The core of the bug: `Billing@corp.com` must not be claimable while
    // `billing@corp.com` exists, because routing treats them as one address.
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_other', email: 'billing@corp.com' })

    const response = await post({ organizationId: 'org_1', email: 'Billing@corp.com' })

    expect(response.status).toBe(409)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('409s on a whitespace-padded variant', async () => {
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_other', email: 'billing@corp.com' })

    const response = await post({ organizationId: 'org_1', email: ' billing@corp.com ' })

    expect(response.status).toBe(409)
  })

  it('maps a racing P2002 to 409 rather than 500', async () => {
    // The pre-check is not authoritative — two concurrent claims can both pass
    // it. The unique index decides, and its violation must read as "taken".
    emailInboxCreateMock.mockRejectedValue(uniqueViolation())

    const response = await post({ organizationId: 'org_1', email: 'billing@corp.com' })

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe(UNAVAILABLE)
  })

  it('reports a soft-deleted holder identically, without leaking that it exists', async () => {
    // Reads are soft-delete filtered, so the pre-check cannot see the holder and
    // the unique index raises instead. The response must not distinguish the
    // two cases, or it becomes an oracle for addresses in other orgs.
    emailInboxFindFirstMock.mockResolvedValue(null)
    emailInboxCreateMock.mockRejectedValue(uniqueViolation())

    const response = await post({ organizationId: 'org_1', email: 'billing@corp.com' })

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe(UNAVAILABLE)
  })

  it('400s an unroutable address instead of storing an inbox that can never receive mail', async () => {
    const response = await post({ organizationId: 'org_1', email: 'not-an-address' })

    expect(response.status).toBe(400)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('403s a request for an organization the user does not belong to', async () => {
    const response = await post({ organizationId: 'org_other', email: 'billing@corp.com' })

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
        headers: { authorization: 'Bearer sk_live_abcdef123456' },
        body: JSON.stringify({ organizationId: 'org_1', email: 'billing@corp.com' }),
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

    const response = await patch('inbox_1', { email: 'Billing@Corp.com', name: 'x' })

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

  it('409s an invalid address rather than treating it as absent', async () => {
    emailInboxFindFirstMock.mockResolvedValue(ROW)

    const response = await patch('inbox_1', { email: 'not-an-address' })

    expect(response.status).toBe(409)
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })
})
