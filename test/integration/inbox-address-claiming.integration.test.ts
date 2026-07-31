/**
 * Cross-tenant inbound email interception (issue #37), end to end against a
 * real Postgres.
 *
 * The unit tests pin the route behaviour with a mocked Prisma. These tests
 * exercise the part that only a real database can prove: that the unique index
 * and the CHECK constraint from `20260721_normalize_inbox_addresses` actually
 * make a second claim on the same address impossible, and that inbound routing
 * consequently delivers to exactly one inbox.
 */
import { vi } from 'vitest'
import { resendClient } from './helpers/resend-stub'
const resend = vi.hoisted(() => ({ send: vi.fn(), verify: vi.fn(), receivingGet: vi.fn() }))
vi.mock('@/lib/resend', () => ({ getResend: () => resendClient(resend) }))

import { describe, it, expect, beforeEach } from 'vitest'
import { POST } from '@/app/api/v1/emailInbox/route'
import { PATCH as patchById } from '@/app/api/v1/emailInbox/[id]/route'
import { POST as webhookPost } from '@/app/api/webhooks/email/route'
import type { ResendEmailData } from '@/app/api/webhooks/email/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'
import { seedInbox } from './helpers/factories'
import { jsonRequest, params } from './helpers/request'

function createInbox(credential: string, organizationId: string, email: string) {
  return POST(
    jsonRequest('http://localhost/api/v1/emailInbox', {
      method: 'POST',
      credential,
      body: { organizationId, email },
    }),
  )
}

function makeEmail(over: Partial<ResendEmailData> = {}): ResendEmailData {
  return {
    id: `resend-claim-${Math.random().toString(36).slice(2)}`,
    from: 'sender@example.com',
    to: ['inbox@test.dev'],
    cc: [],
    bcc: [],
    subject: 'Invoice',
    text: 'body',
    html: '<p>body</p>',
    headers: {},
    created_at: new Date().toISOString(),
    ...over,
  }
}

describe('inbox address claiming — cross-tenant interception (#37)', () => {
  beforeEach(() => {
    resend.send.mockReset()
    resend.verify.mockReset()
    resend.receivingGet.mockReset()
  })

  it('stores a claimed address normalized', async () => {
    const { org, token } = await createOrgWithUser()

    const res = await createInbox(token, org.id, '  Billing@Corp.com ')
    expect(res.status).toBe(201)

    const { data } = await res.json()
    expect(data.email).toBe('billing@corp.com')

    const row = await prisma.emailInbox.findUniqueOrThrow({ where: { id: data.id } })
    expect(row.email).toBe('billing@corp.com')
  })

  it('409s a second tenant claiming a case variant of an address already in use', async () => {
    // The attack: tenant B holds `Billing@Corp.com`, tenant A tries to claim
    // the lowercase form the router actually matches on.
    const b = await createOrgWithUser()
    expect((await createInbox(b.token, b.org.id, 'Billing@Corp.com')).status).toBe(201)

    const a = await createSecondOrg()
    for (const variant of ['billing@corp.com', 'BILLING@CORP.COM', ' Billing@corp.com ']) {
      const res = await createInbox(a.token, a.org.id, variant)
      expect(res.status).toBe(409)
      expect((await res.json()).message).toBe('Email address is not available')
    }

    expect(await prisma.emailInbox.count({ where: { email: 'billing@corp.com' } })).toBe(1)
  })

  it('refuses to change an inbox address at all — the address is immutable', async () => {
    // Re-pointing was a second route to interception (move a throwaway inbox
    // onto a case variant of a tenant's address), so PATCH no longer changes
    // the address for any target, occupied or free.
    const b = await createOrgWithUser()
    await seedInbox(b.org.id, b.user.id, { email: 'billing@corp.com' })

    const a = await createSecondOrg()
    const attacker = await seedInbox(a.org.id, a.user.id, { email: 'throwaway@corp.com' })

    // Onto another tenant's address...
    const ontoTaken = await patchById(
      jsonRequest(`http://localhost/api/v1/emailInbox/${attacker.id}`, {
        method: 'PATCH',
        credential: a.token,
        body: { email: 'BILLING@Corp.com' },
      }),
      params({ id: attacker.id }),
    )
    expect(ontoTaken.status).toBe(409)

    // ...and onto a completely unused address: still refused.
    const ontoFree = await patchById(
      jsonRequest(`http://localhost/api/v1/emailInbox/${attacker.id}`, {
        method: 'PATCH',
        credential: a.token,
        body: { email: 'brand-new@corp.com' },
      }),
      params({ id: attacker.id }),
    )
    expect(ontoFree.status).toBe(409)

    const row = await prisma.emailInbox.findUniqueOrThrow({ where: { id: attacker.id } })
    expect(row.email).toBe('throwaway@corp.com')
  })

  it('allows renaming an inbox (name is mutable, address is not)', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id, { email: 'keep@corp.com', name: 'Old' })

    const res = await patchById(
      jsonRequest(`http://localhost/api/v1/emailInbox/${inbox.id}`, {
        method: 'PATCH',
        credential: a.token,
        body: { name: 'New', email: 'keep@corp.com' },
      }),
      params({ id: inbox.id }),
    )

    expect(res.status).toBe(200)
    const row = await prisma.emailInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(row.name).toBe('New')
    expect(row.email).toBe('keep@corp.com')
  })

  it('delivers an inbound email to exactly one inbox, in the owning org', async () => {
    const b = await createOrgWithUser()
    const created = await createInbox(b.token, b.org.id, 'Billing@Corp.com')
    const { data: victim } = await created.json()

    // The attacker cannot get a second row for this address at all.
    const a = await createSecondOrg()
    expect((await createInbox(a.token, a.org.id, 'billing@corp.com')).status).toBe(409)

    resend.verify.mockReturnValue(undefined)
    const email = makeEmail({ id: 'resend-claim-fanout', to: ['Billing@Corp.com'] })
    resend.receivingGet.mockResolvedValue({ data: email })

    const res = await webhookPost(
      jsonRequest('http://localhost/api/v1/webhooks/email', {
        method: 'POST',
        body: { type: 'email.received', data: { email_id: email.id } },
      }),
    )
    expect(res.status).toBe(200)

    const rows = await prisma.emailMessage.findMany({ where: { externalId: email.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].inboxEmailAddressId).toBe(victim.id)
    expect(rows[0].organizationId).toBe(b.org.id)
  })

  it('rejects a non-normalized address at the database layer, not just in the route', async () => {
    // The CHECK constraint is what makes the byte-exact unique index a real
    // one-address-one-inbox guarantee. Any future write path that forgets to
    // normalize fails here rather than silently reopening the interception.
    const { org, user } = await createOrgWithUser()

    // Each of these violates a different clause of the CHECK and must be rejected
    // at the DB, matching the app's PRINTABLE_ASCII rule (lowercase, no
    // whitespace, ASCII, no control chars). The control/DEL cases are the ones an
    // ASCII+no-whitespace constraint would have let through.
    const rejected = [
      'Mixed@Case.dev', // uppercase
      'a b@corp.com', // interior space
      `caf${String.fromCodePoint(0x00e9)}@corp.com`, // non-ASCII (é)
      `a${String.fromCodePoint(0x0007)}b@corp.com`, // BEL control char
      `a${String.fromCodePoint(0x007f)}b@corp.com`, // DEL
    ]
    for (const email of rejected) {
      await expect(
        prisma.emailInbox.create({
          data: { organizationId: org.id, userId: user.id, email },
        }),
      ).rejects.toThrow()
    }

    expect(await prisma.emailInbox.count({ where: { organizationId: org.id } })).toBe(0)
  })

  it('keeps a soft-deleted inbox\'s address claimed', async () => {
    // Routing keeps delivering to the address after deletion, so freeing it
    // would hand the next claimant the previous owner's still-arriving mail.
    const b = await createOrgWithUser()
    const inbox = await seedInbox(b.org.id, b.user.id, { email: 'gone@corp.com' })
    await prisma.emailInbox.update({ where: { id: inbox.id }, data: { deletedAt: new Date() } })

    const a = await createSecondOrg()
    const res = await createInbox(a.token, a.org.id, 'Gone@Corp.com')

    expect(res.status).toBe(409)
    expect((await res.json()).message).toBe('Email address is not available')
  })
})
