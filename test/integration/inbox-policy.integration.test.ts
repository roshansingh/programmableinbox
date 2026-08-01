/**
 * Inbox-creation policy against a real Postgres (issue #98).
 *
 * The unit suites prove the rules and prove the routes call them, both with
 * Prisma mocked. What only a real database can settle is the part the issue
 * actually cares about: that a rejected request leaves **no row behind**. A
 * policy that returns 400 after writing the inbox would look correct in every
 * mocked test and still hand out the address.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST } from '@/app/api/app/emailInbox/route'
import { PATCH as patchById } from '@/app/api/app/emailInbox/[id]/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser } from './helpers/auth'
import { seedInbox } from './helpers/factories'
import { jsonRequest, params } from './helpers/request'
import { resetConfigCache } from '@/lib/config'

const CONFIGURED = process.env.EMAIL_INBOX_DOMAINS

function createInbox(
  credential: string,
  organizationId: string,
  email: string,
  name?: string,
) {
  return POST(
    jsonRequest('http://localhost/api/app/emailInbox', {
      method: 'POST',
      credential,
      body: { organizationId, email, ...(name !== undefined && { name }) },
    }),
  )
}

function rename(credential: string, id: string, name: string) {
  return patchById(
    jsonRequest(`http://localhost/api/app/emailInbox/${id}`, {
      method: 'PATCH',
      credential,
      body: { name },
    }),
    params({ id }),
  )
}

/** Proves the rejection was not a write followed by an error response. */
async function inboxCount(email: string) {
  return prisma.emailInbox.count({ where: { email } })
}

afterEach(() => {
  process.env.EMAIL_INBOX_DOMAINS = CONFIGURED
  // config memoizes per domain per process; restoring the env is only half the
  // job without dropping the memo.
  resetConfigCache()
})

describe('POST /api/app/emailInbox — domain allowlist', () => {
  it('201s at a configured domain and persists the row', async () => {
    const { token, org } = await createOrgWithUser()

    const res = await createInbox(token, org.id, 'qa-team@test.dev')

    expect(res.status).toBe(201)
    expect(await inboxCount('qa-team@test.dev')).toBe(1)
  })

  it('400s an unconfigured domain and writes nothing', async () => {
    const { token, org } = await createOrgWithUser()

    const res = await createInbox(token, org.id, 'qa-team@gmail.com')

    expect(res.status).toBe(400)
    expect(await inboxCount('qa-team@gmail.com')).toBe(0)
  })

  it('400s a subdomain of a configured domain', async () => {
    const { token, org } = await createOrgWithUser()

    const res = await createInbox(token, org.id, 'qa-team@evil.test.dev')

    expect(res.status).toBe(400)
    expect(await inboxCount('qa-team@evil.test.dev')).toBe(0)
  })

  /**
   * EMAIL_INBOX_DOMAINS is required and asserted at boot, so this is a degraded
   * state a running server cannot normally be in. The property that still
   * matters against a real database is that it writes nothing — never that it
   * falls back to accepting the address.
   */
  it('writes nothing when EMAIL_INBOX_DOMAINS is unset', async () => {
    delete process.env.EMAIL_INBOX_DOMAINS
    resetConfigCache()
    const { token, org } = await createOrgWithUser()

    const res = await createInbox(token, org.id, 'qa-team@test.dev')

    expect(res.status).not.toBe(201)
    expect(await inboxCount('qa-team@test.dev')).toBe(0)
  })
})

describe('POST /api/app/emailInbox — impersonation blocklist', () => {
  it.each([
    ['amazon-security', 'embedded brand'],
    ['g00gle', 'leetspeak'],
    ['g-o-o-g-l-e', 'separator evasion'],
    ['pi-support', 'platform self-impersonation'],
    ['billing', 'staff-sounding term'],
  ])('422s %s (%s) and writes nothing', async (localPart) => {
    const { token, org } = await createOrgWithUser()

    const res = await createInbox(token, org.id, `${localPart}@test.dev`)

    expect(res.status).toBe(422)
    expect(await inboxCount(`${localPart}@test.dev`)).toBe(0)
  })

  it('422s a blocked display name and writes nothing', async () => {
    const { token, org } = await createOrgWithUser()

    const res = await createInbox(token, org.id, 'qa-team@test.dev', 'Amazon Support')

    expect(res.status).toBe(422)
    expect(await inboxCount('qa-team@test.dev')).toBe(0)
  })

  it('422s a non-ASCII display name the term list alone would miss', async () => {
    const { token, org } = await createOrgWithUser()

    // U+0410 CYRILLIC CAPITAL LETTER A.
    const res = await createInbox(token, org.id, 'qa-team@test.dev', 'Аmazon')

    expect(res.status).toBe(422)
    expect(await inboxCount('qa-team@test.dev')).toBe(0)
  })

  it('leaves a rejected address free for a legitimate claim afterwards', async () => {
    // The address must not be silently consumed by the failed attempt — the
    // unique index keeps soft-deleted rows forever, so a stray write here would
    // retire the address permanently.
    const { token, org } = await createOrgWithUser()

    expect((await createInbox(token, org.id, 'qa-team@test.dev', 'Amazon')).status).toBe(422)
    expect((await createInbox(token, org.id, 'qa-team@test.dev', 'QA Team')).status).toBe(201)
  })
})

describe('PATCH /api/app/emailInbox/[id] — rename policy', () => {
  let token: string
  let inboxId: string

  beforeEach(async () => {
    const ctx = await createOrgWithUser()
    token = ctx.token
    const inbox = await seedInbox(ctx.org.id, ctx.user.id, { email: 'qa-team@test.dev' })
    inboxId = inbox.id
  })

  it('allows an ordinary rename', async () => {
    const res = await rename(token, inboxId, 'QA Team')

    expect(res.status).toBe(200)
    const row = await prisma.emailInbox.findUnique({ where: { id: inboxId } })
    expect(row?.name).toBe('QA Team')
  })

  it('422s a rename to a blocked brand and leaves the stored name untouched', async () => {
    // The escape the create-only check left open: claim an innocuous name, then
    // rename to something a recipient reads as a brand.
    const res = await rename(token, inboxId, 'Amazon Support')

    expect(res.status).toBe(422)
    const row = await prisma.emailInbox.findUnique({ where: { id: inboxId } })
    expect(row?.name).not.toBe('Amazon Support')
  })

  it('422s a rename to a non-ASCII homoglyph', async () => {
    const res = await rename(token, inboxId, 'Аmazon')

    expect(res.status).toBe(422)
    const row = await prisma.emailInbox.findUnique({ where: { id: inboxId } })
    expect(row?.name).not.toBe('Аmazon')
  })
})
