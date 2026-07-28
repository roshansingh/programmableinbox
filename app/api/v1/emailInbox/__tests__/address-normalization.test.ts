/**
 * Address claiming must agree with inbound routing (F1 / issue #37).
 *
 * The unique index on `email_inboxes.email` is byte-exact, but the webhook
 * lowercases the inbound recipient before matching
 * (app/api/v1/webhooks/email/route.ts). Left alone, that mismatch reopens the
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
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAuthenticatedUserMock = vi.fn()
const emailInboxCreateMock = vi.fn()
const emailInboxFindFirstMock = vi.fn()
const emailInboxFindUniqueMock = vi.fn()
const emailInboxUpdateMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUserMock(...args),
}))

vi.mock('@/lib/auth/auth-context', () => ({
  resolveAuthContext: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      create: (...args: unknown[]) => emailInboxCreateMock(...args),
      findFirst: (...args: unknown[]) => emailInboxFindFirstMock(...args),
      findUnique: (...args: unknown[]) => emailInboxFindUniqueMock(...args),
      findMany: vi.fn(),
      update: (...args: unknown[]) => emailInboxUpdateMock(...args),
    },
    emailMessage: { updateMany: vi.fn() },
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

const USER = { id: 'user_1', memberships: [{ organizationId: 'org_1', role: 'owner' }] }
const UNAVAILABLE = 'Email address is not available'
const IMMUTABLE = 'The address of an inbox cannot be changed. Create a new inbox instead.'

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  getAuthenticatedUserMock.mockResolvedValue(USER)
  emailInboxFindFirstMock.mockResolvedValue(null)
})

async function post(body: unknown) {
  const { POST } = await import('../route')
  return POST(
    new Request('http://localhost/api/v1/emailInbox', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as never,
  )
}

async function patch(id: string, body: unknown) {
  const { PATCH } = await import('../[id]/route')
  return PATCH(
    new Request(`http://localhost/api/v1/emailInbox/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id }) },
  )
}

describe('POST /api/v1/emailInbox — address normalization', () => {
  it('persists the address lowercased and trimmed', async () => {
    emailInboxCreateMock.mockResolvedValue({ id: 'inbox_1', email: 'billing@corp.com' })

    const response = await post({ organizationId: 'org_1', email: '  Billing@Corp.com ' })

    expect(response.status).toBe(201)
    expect(emailInboxCreateMock.mock.calls[0][0].data.email).toBe('billing@corp.com')
  })

  it('checks availability against the normalized address, not the raw input', async () => {
    emailInboxCreateMock.mockResolvedValue({ id: 'inbox_1' })

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

    const response = await post({ organizationId: 'org_1', email: 'Billing@Corp.com' })

    expect(response.status).toBe(409)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('409s on a whitespace-padded variant', async () => {
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_other', email: 'billing@corp.com' })

    const response = await post({ organizationId: 'org_1', email: ' billing@corp.com  ' })

    expect(response.status).toBe(409)
  })

  it('maps a racing P2002 to 409 rather than 500', async () => {
    // Two requests can pass the pre-check concurrently; the unique index is
    // what actually decides, so its violation must not surface as a 500.
    emailInboxCreateMock.mockRejectedValue(uniqueViolation())

    const response = await post({ organizationId: 'org_1', email: 'billing@corp.com' })

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe(UNAVAILABLE)
  })

  it('reports a soft-deleted holder identically, without leaking that it exists', async () => {
    // Reads are soft-delete filtered, so the pre-check cannot see a deleted
    // inbox holding the address — the index catches it and must answer with
    // the same message, so this endpoint cannot probe other tenants.
    emailInboxFindFirstMock.mockResolvedValue(null)
    emailInboxCreateMock.mockRejectedValue(uniqueViolation())

    const response = await post({ organizationId: 'org_1', email: 'deleted@corp.com' })

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe(UNAVAILABLE)
  })

  it('400s an unroutable address instead of storing an inbox that can never receive mail', async () => {
    const response = await post({ organizationId: 'org_1', email: 'not-an-address' })

    expect(response.status).toBe(400)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('400s a non-string address', async () => {
    const response = await post({ organizationId: 'org_1', email: { toString: 'nope' } })

    expect(response.status).toBe(400)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('400s a whitespace-only address rather than claiming the empty string', async () => {
    const response = await post({ organizationId: 'org_1', email: '   ' })

    expect(response.status).toBe(400)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('400s a non-ASCII address so no homoglyph/Unicode inbox is ever created', async () => {
    // Cyrillic а (U+0430) — a confusable of Latin `admin`. Built from a code
    // point so the assertion cannot be defeated by an invisible source edit.
    const homoglyph = `${String.fromCodePoint(0x0430)}dmin@corp.com`
    const response = await post({ organizationId: 'org_1', email: homoglyph })

    expect(response.status).toBe(400)
    expect(emailInboxCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a foreign organization before touching the address at all', async () => {
    const response = await post({ organizationId: 'org_other', email: 'billing@corp.com' })

    expect(response.status).toBe(403)
    expect(emailInboxFindFirstMock).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/v1/emailInbox/[id] — the address is immutable', () => {
  beforeEach(() => {
    emailInboxFindUniqueMock.mockResolvedValue({
      id: 'inbox_1',
      userId: 'user_1',
      organizationId: 'org_1',
      email: 'old@corp.com',
    })
  })

  it('409s when asked to change the address to a different one', async () => {
    const response = await patch('inbox_1', { email: 'billing@corp.com' })

    expect(response.status).toBe(409)
    expect((await response.json()).message).toBe(IMMUTABLE)
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })

  it('409s on a case/whitespace variant of the current address — that is still a change', async () => {
    // The stored address is already normalized, so `Old@Corp.com` and
    // ` old@corp.com ` normalize back to it and are treated as a no-op; a
    // genuinely different address (even if it only differs before normalization)
    // is refused. This one differs post-normalization.
    const response = await patch('inbox_1', { email: 'new@corp.com' })

    expect(response.status).toBe(409)
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })

  it('409s rather than silently ignoring the email field', async () => {
    // Failing loudly matters: a client that thinks it changed the address must
    // not get a 200 back and assume the change took.
    const response = await patch('inbox_1', { email: 'billing@corp.com', name: 'Renamed' })

    expect(response.status).toBe(409)
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })

  it('409s on an invalid email rather than 400 — the field cannot change either way', async () => {
    const response = await patch('inbox_1', { email: 'not-an-address' })

    expect(response.status).toBe(409)
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })

  it('treats resubmitting the current address (any case/padding) as a no-op', async () => {
    emailInboxUpdateMock.mockResolvedValue({ id: 'inbox_1', email: 'old@corp.com', name: 'Renamed' })

    const response = await patch('inbox_1', { email: ' Old@Corp.com ', name: 'Renamed' })

    expect(response.status).toBe(200)
    // Even on the no-op path, `email` is never written back.
    expect(emailInboxUpdateMock.mock.calls[0][0].data).not.toHaveProperty('email')
  })

  it('renames via the name field and never writes email', async () => {
    emailInboxUpdateMock.mockResolvedValue({ id: 'inbox_1', email: 'old@corp.com', name: 'Renamed' })

    const response = await patch('inbox_1', { name: 'Renamed' })

    expect(response.status).toBe(200)
    expect(emailInboxUpdateMock.mock.calls[0][0].data).toEqual({ name: 'Renamed' })
  })

  it('404s a foreign inbox before evaluating the body', async () => {
    emailInboxFindUniqueMock.mockResolvedValue({ id: 'inbox_1', userId: 'someone_else' })

    const response = await patch('inbox_1', { email: 'billing@corp.com' })

    expect(response.status).toBe(404)
    expect(emailInboxUpdateMock).not.toHaveBeenCalled()
  })

  it('still 500s on unrelated failures', async () => {
    emailInboxUpdateMock.mockRejectedValue(new Error('connection reset'))

    const response = await patch('inbox_1', { name: 'Renamed' })

    expect(response.status).toBe(500)
  })
})
