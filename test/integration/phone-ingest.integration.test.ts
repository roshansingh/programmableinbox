import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CommercialProvider } from '@/lib/commercial/provider'
import { UNLIMITED } from '@/lib/commercial/plan-limits'
import type { IQuota, QuotaMetric, QuotaResult } from '@/lib/commercial/interfaces'
import { prisma } from '@/lib/db'
import { storeIncomingSms } from '@/lib/services/phone-ingest'
import type { ParsedInboundSms } from '@/lib/sms/webhook'
import { createOrgWithUser } from './helpers/auth'

const NUMBER = '+14155550100'

type Call = { op: 'consume' | 'refund' | 'increment'; metric: QuotaMetric; organizationId: string }

/** Records what the service asks of the quota; `allow` decides `consume`. */
function useQuota(
  allow = true,
  opts: { limits?: Partial<typeof UNLIMITED>; refundFails?: boolean } = {},
) {
  const calls: Call[] = []
  const result = (): QuotaResult => ({ allowed: allow, limit: allow ? null : 0, used: 0, resetsAt: null })
  const quota: IQuota = {
    consume: async (organizationId, metric) => {
      calls.push({ op: 'consume', metric, organizationId })
      return result()
    },
    refund: async (organizationId, metric) => {
      calls.push({ op: 'refund', metric, organizationId })
      if (opts.refundFails) throw new Error('refund failed: redis/db unreachable')
    },
    increment: async (organizationId, metric) => {
      calls.push({ op: 'increment', metric, organizationId })
    },
    peek: async () => result(),
    peekMany: async () => new Map(),
  }
  CommercialProvider.configure(
    {
      resolve: async () => ({
        planCode: 'test',
        planName: 'Test',
        limits: { ...UNLIMITED, ...opts.limits },
        periodStart: null,
        periodEnd: null,
      }),
    },
    quota,
    CommercialProvider.metering,
  )
  return calls
}

function sms(over: Partial<ParsedInboundSms> = {}): ParsedInboundSms {
  return {
    externalId: 'SM' + 'a'.repeat(32),
    from: '+14155550199',
    to: NUMBER,
    body: 'Your code is 123456',
    mediaCount: 0,
    ...over,
  }
}

async function seedInbox(
  status: 'pending' | 'active' | 'released' | 'failed' = 'active',
  phoneNumber = NUMBER,
) {
  const a = await createOrgWithUser()
  const inbox = await prisma.phoneInbox.create({
    data: { organizationId: a.org.id, userId: a.user.id, phoneNumber, countryCode: 'US', status },
  })
  return { inbox, org: a.org }
}

afterEach(() => CommercialProvider.reset())
beforeEach(() => useQuota())

describe('storeIncomingSms', () => {
  it('stores the message against the active inbox for the number it was sent to', async () => {
    const { inbox, org } = await seedInbox()

    expect(await storeIncomingSms(sms({ mediaCount: 2 }))).toBe('stored')

    const rows = await prisma.phoneMessage.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      phoneInboxId: inbox.id,
      organizationId: org.id,
      from: '+14155550199',
      to: NUMBER,
      body: 'Your code is 123456',
      mediaCount: 2,
      externalId: 'SM' + 'a'.repeat(32),
      extractedOtp: null,
    })
  })

  it('threads by inbox and counterparty', async () => {
    const { inbox } = await seedInbox()

    await storeIncomingSms(sms({ externalId: 'SM1', from: '32665' }))
    await storeIncomingSms(sms({ externalId: 'SM2', from: '32665' }))
    await storeIncomingSms(sms({ externalId: 'SM3', from: '+14155550188' }))

    const byId = Object.fromEntries((await prisma.phoneMessage.findMany()).map((m) => [m.externalId, m.threadId]))
    expect(byId.SM1).toBe(`${inbox.id}:32665`)
    expect(byId.SM2).toBe(byId.SM1)
    expect(byId.SM3).toBe(`${inbox.id}:+14155550188`)
  })

  it('consumes one sms.received unit for the owning organization, before storing', async () => {
    const calls = useQuota()
    const { org } = await seedInbox()

    await storeIncomingSms(sms())

    expect(calls).toEqual([{ op: 'consume', metric: 'sms.received', organizationId: org.id }])
  })

  it('stores one row and gives the unit back when Twilio re-sends the same MessageSid', async () => {
    const calls = useQuota()
    const { org } = await seedInbox()

    expect(await storeIncomingSms(sms())).toBe('stored')
    expect(await storeIncomingSms(sms())).toBe('duplicate')

    expect(await prisma.phoneMessage.count()).toBe(1)
    expect(calls.filter((c) => c.op === 'refund')).toEqual([
      { op: 'refund', metric: 'sms.received', organizationId: org.id },
    ])
  })

  it('drops over-quota messages, counts the drop, and stores nothing', async () => {
    const calls = useQuota(false)
    const { org } = await seedInbox()

    expect(await storeIncomingSms(sms())).toBe('dropped')

    expect(await prisma.phoneMessage.count()).toBe(0)
    expect(calls).toEqual([
      { op: 'consume', metric: 'sms.received', organizationId: org.id },
      { op: 'increment', metric: 'sms.dropped', organizationId: org.id },
    ])
  })

  it.each(['pending', 'released', 'failed'] as const)(
    'ignores a message to a number whose inbox is %s, without touching quota',
    async (status) => {
      const calls = useQuota()
      await seedInbox(status)

      expect(await storeIncomingSms(sms())).toBe('no-inbox')

      expect(await prisma.phoneMessage.count()).toBe(0)
      expect(calls).toEqual([])
    },
  )

  it('ignores a message to a number nobody holds', async () => {
    expect(await storeIncomingSms(sms({ to: '+14155550177' }))).toBe('no-inbox')
  })

  it('delivers to the current holder after a number changes hands', async () => {
    const first = await seedInbox('active')
    await prisma.phoneInbox.update({ where: { id: first.inbox.id }, data: { status: 'released' } })
    const second = await seedInbox('active')

    await storeIncomingSms(sms())

    const [row] = await prisma.phoneMessage.findMany()
    expect(row.phoneInboxId).toBe(second.inbox.id)
    expect(row.organizationId).toBe(second.org.id)
  })

  // A cancelled subscription resolves to Free, but the number stays active at
  // Twilio. Free has no SMS limit key (which means "unlimited"), so the plan's
  // feature flag is what has to stop the traffic.
  it('drops everything for an organization whose plan has no phone inboxes, without consuming quota', async () => {
    const calls = useQuota(true, { limits: { phoneInboxesEnabled: false } })
    const { org } = await seedInbox()

    expect(await storeIncomingSms(sms())).toBe('dropped')

    expect(await prisma.phoneMessage.count()).toBe(0)
    expect(calls).toEqual([{ op: 'increment', metric: 'sms.dropped', organizationId: org.id }])
  })

  // Twilio's MessageSid is globally unique and signatures never expire, so a
  // re-sent or replayed delivery can arrive after the number changed hands.
  it('does not store a re-sent MessageSid in the next holder of the number', async () => {
    const first = await seedInbox('active')
    await storeIncomingSms(sms())
    await prisma.phoneInbox.update({ where: { id: first.inbox.id }, data: { status: 'released' } })
    const second = await seedInbox('active')

    expect(await storeIncomingSms(sms())).toBe('duplicate')

    expect(await prisma.phoneMessage.count({ where: { phoneInboxId: second.inbox.id } })).toBe(0)
  })

  // At the cap, Twilio's retry of a message we already stored is refused by
  // `consume`. Reporting it as dropped would inflate the "lost" number with a
  // message the organization has.
  it('reports a re-sent, already-stored message as a duplicate even when quota is exhausted', async () => {
    await seedInbox()
    useQuota(true)
    await storeIncomingSms(sms())
    const calls = useQuota(false)

    expect(await storeIncomingSms(sms())).toBe('duplicate')

    expect(calls.filter((c) => c.op === 'increment')).toEqual([])
  })

  it('rethrows the storage error, not a refund error, when both fail', async () => {
    useQuota(true, { refundFails: true })
    await seedInbox()

    await expect(storeIncomingSms(sms({ body: 'a\u0000b' }))).rejects.toThrow(/0x00|invalid byte|null/i)
  })

  it('gives the unit back and rethrows when the insert fails for any other reason', async () => {
    const calls = useQuota()
    await seedInbox()

    // A `from` longer than a text column can hold is not the failure here; a
    // NUL byte that slipped past parsing is, and Postgres refuses it.
    await expect(storeIncomingSms(sms({ body: 'a\u0000b' }))).rejects.toThrow()

    expect(calls.map((c) => c.op)).toEqual(['consume', 'refund'])
    expect(await prisma.phoneMessage.count()).toBe(0)
  })

  it('stores an emoji body, an empty body, and a 4000-character body', async () => {
    await seedInbox()

    await storeIncomingSms(sms({ externalId: 'SM1', body: '🔐 code 123456 🔐' }))
    await storeIncomingSms(sms({ externalId: 'SM2', body: '', mediaCount: 1 }))
    await storeIncomingSms(sms({ externalId: 'SM3', body: 'x'.repeat(4000) }))

    expect(await prisma.phoneMessage.count()).toBe(3)
  })
})
