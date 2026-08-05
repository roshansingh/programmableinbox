import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withConfigEnv } from '@/test/config'

const inboxFindFirstMock = vi.fn()
const inboxCreateMock = vi.fn()
const inboxUpdateMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      findFirst: (...a: unknown[]) => inboxFindFirstMock(...a),
      create: (...a: unknown[]) => inboxCreateMock(...a),
      update: (...a: unknown[]) => inboxUpdateMock(...a),
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const SCOPE = { organizationId: 'org_1', userId: 'user_1' }

/**
 * The address policy is real, not mocked. These services exist so that
 * `/api/app` and `/api/v1` cannot disagree about what a legal address is —
 * mocking the validator would let the tests pass while the two surfaces
 * enforced different rules, which is the exact failure the extraction prevents.
 */
const ALLOWED = 'someone@mail.programmableinbox.com'

describe('createInbox', () => {
  withConfigEnv({ EMAIL_INBOX_DOMAINS: 'mail.programmableinbox.com' })

  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('stores the normalized address, not the submitted one', async () => {
    inboxFindFirstMock.mockResolvedValue(null)
    inboxCreateMock.mockImplementation(({ data }: { data: unknown }) => ({ id: 'inbox_1', ...(data as object) }))
    const { createInbox } = await import('../email-inbox')

    const result = await createInbox(SCOPE, { email: '  SomeOne@Mail.ProgrammableInbox.com ' })

    expect(result.error).toBeUndefined()
    expect(inboxCreateMock).toHaveBeenCalledWith({
      data: {
        organizationId: 'org_1',
        userId: 'user_1',
        email: ALLOWED,
        name: null,
      },
    })
  })

  it('refuses a scope that does not say which organization the inbox lands in', async () => {
    // Only a user can produce one, and only by not naming an organization. A
    // key is always bound, so this path is unreachable for a key.
    const { createInbox } = await import('../email-inbox')

    const result = await createInbox({ organizationId: null, userId: 'user_1' }, { email: ALLOWED })

    expect(result.error?.status).toBe(400)
    expect(inboxCreateMock).not.toHaveBeenCalled()
  })

  it('rejects an address that is not a valid address at all', async () => {
    const { createInbox } = await import('../email-inbox')

    const result = await createInbox(SCOPE, { email: 'not-an-address' })

    expect(result.error?.status).toBe(400)
    expect(inboxCreateMock).not.toHaveBeenCalled()
  })

  it('enforces the domain policy before claiming the address', async () => {
    const { createInbox } = await import('../email-inbox')

    const result = await createInbox(SCOPE, { email: 'someone@not-our-domain.example' })

    expect(result.error).toBeDefined()
    // Nothing may touch the table before policy has passed — a rejected
    // address must not be probeable and must not race for the unique index.
    expect(inboxFindFirstMock).not.toHaveBeenCalled()
    expect(inboxCreateMock).not.toHaveBeenCalled()
  })

  it('enforces the name policy', async () => {
    const { createInbox } = await import('../email-inbox')

    const result = await createInbox(SCOPE, { email: ALLOWED, name: 'Amazon Support' })

    expect(result.error).toBeDefined()
    expect(inboxCreateMock).not.toHaveBeenCalled()
  })

  it('persists the trimmed name the policy actually judged', async () => {
    inboxFindFirstMock.mockResolvedValue(null)
    inboxCreateMock.mockResolvedValue({ id: 'inbox_1' })
    const { createInbox } = await import('../email-inbox')

    await createInbox(SCOPE, { email: ALLOWED, name: '  QA Signups  ' })

    expect(inboxCreateMock.mock.calls[0][0].data.name).toBe('QA Signups')
  })

  it('stores a whitespace-only name as absent rather than as a space', async () => {
    inboxFindFirstMock.mockResolvedValue(null)
    inboxCreateMock.mockResolvedValue({ id: 'inbox_1' })
    const { createInbox } = await import('../email-inbox')

    await createInbox(SCOPE, { email: ALLOWED, name: '   ' })

    expect(inboxCreateMock.mock.calls[0][0].data.name).toBeNull()
  })

  it('409s an address already held, without saying who holds it', async () => {
    inboxFindFirstMock.mockResolvedValue({ id: 'other_inbox' })
    const { createInbox } = await import('../email-inbox')

    const result = await createInbox(SCOPE, { email: ALLOWED })

    expect(result.error?.status).toBe(409)
    expect(result.error?.message).toBe('Email address is not available')
    expect(inboxCreateMock).not.toHaveBeenCalled()
  })

  it('409s identically when the unique index is what catches the race', async () => {
    // The pre-check is soft-delete filtered and two requests can both pass it,
    // so the index is the authority. Its rejection must be indistinguishable
    // from the pre-check's, or the difference leaks that a deleted inbox holds
    // the address.
    inboxFindFirstMock.mockResolvedValue(null)
    inboxCreateMock.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['email'] } }),
    )
    const { createInbox } = await import('../email-inbox')

    const result = await createInbox(SCOPE, { email: ALLOWED })

    expect(result.error?.status).toBe(409)
    expect(result.error?.message).toBe('Email address is not available')
  })

  it('does not swallow an unexpected database failure', async () => {
    inboxFindFirstMock.mockResolvedValue(null)
    inboxCreateMock.mockRejectedValue(new Error('connection reset'))
    const { createInbox } = await import('../email-inbox')

    await expect(createInbox(SCOPE, { email: ALLOWED })).rejects.toThrow('connection reset')
  })
})

describe('updateInbox under an inbox write scope', () => {
  withConfigEnv({ EMAIL_INBOX_DOMAINS: 'mail.programmableinbox.com' })

  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('constrains the lookup by organization as well as creator', async () => {
    inboxFindFirstMock.mockResolvedValue(null)
    const { getInboxForWrite } = await import('../email-inbox')

    const result = await getInboxForWrite(SCOPE, 'inbox_1')

    expect(result).toBeNull()
    expect(inboxFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1', userId: 'user_1', organizationId: 'org_1' },
    })
  })

  it('constrains by creator alone when no organization is named', async () => {
    // The dashboard PATCH path. Adding `organizationId: null` to the predicate
    // would match no row at all, since the column is NOT NULL.
    inboxFindFirstMock.mockResolvedValue(null)
    const { getInboxForWrite } = await import('../email-inbox')

    await getInboxForWrite({ organizationId: null, userId: 'user_1' }, 'inbox_1')

    expect(inboxFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1', userId: 'user_1' },
    })
  })

  it('renames an inbox it can reach', async () => {
    inboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', email: ALLOWED })
    inboxUpdateMock.mockResolvedValue({ id: 'inbox_1', name: 'QA Signups' })
    const { updateInboxForWrite } = await import('../email-inbox')

    const result = await updateInboxForWrite(SCOPE, 'inbox_1', { name: '  QA Signups  ' })

    expect(result.error).toBeUndefined()
    expect(inboxUpdateMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1' },
      data: { name: 'QA Signups' },
    })
  })

  it('404s an inbox outside the scope rather than reporting why', async () => {
    inboxFindFirstMock.mockResolvedValue(null)
    const { updateInboxForWrite } = await import('../email-inbox')

    const result = await updateInboxForWrite(SCOPE, 'inbox_1', { name: 'x' })

    expect(result.error?.status).toBe(404)
    expect(inboxUpdateMock).not.toHaveBeenCalled()
  })

  it('refuses to re-point the address', async () => {
    inboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', email: ALLOWED })
    const { updateInboxForWrite } = await import('../email-inbox')

    const result = await updateInboxForWrite(SCOPE, 'inbox_1', {
      email: 'elsewhere@mail.programmableinbox.com',
      name: 'x',
    })

    expect(result.error?.status).toBe(409)
    expect(inboxUpdateMock).not.toHaveBeenCalled()
  })

  it('allows a submission that matches the current address after normalization', async () => {
    // So a client can PATCH a whole record back to rename it.
    inboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', email: ALLOWED })
    inboxUpdateMock.mockResolvedValue({ id: 'inbox_1' })
    const { updateInboxForWrite } = await import('../email-inbox')

    const result = await updateInboxForWrite(SCOPE, 'inbox_1', {
      email: '  SomeOne@Mail.ProgrammableInbox.com  ',
      name: 'QA Signups',
    })

    expect(result.error).toBeUndefined()
    expect(inboxUpdateMock).toHaveBeenCalled()
  })

  it('applies the same name policy as creation', async () => {
    inboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', email: ALLOWED })
    const { updateInboxForWrite } = await import('../email-inbox')

    const result = await updateInboxForWrite(SCOPE, 'inbox_1', { name: 'Amazon Support' })

    expect(result.error).toBeDefined()
    expect(inboxUpdateMock).not.toHaveBeenCalled()
  })
})
