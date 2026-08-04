/**
 * Message search against a real Postgres (issue #106).
 *
 * These are the tests that matter for this feature. Everything about it —
 * stemming, the weighted generated column, websearch operator parsing, array
 * overlap, the ILIKE escaping, and the fact that the generated column populates
 * itself at all — is Postgres behaviour, and a mocked `$queryRaw` proves none of
 * it. The unit tests in lib/services/__tests__/message-search.test.ts assert the
 * SQL is *shaped* right; these assert it is *correct*.
 */
import { describe, it, expect } from 'vitest'
import { GET as listAppMessages } from '@/app/api/app/emailInbox/[id]/messages/route'
import { GET as listV1Messages } from '@/app/api/v1/emailInbox/[id]/messages/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createApiKey } from './helpers/auth'
import { seedInbox, seedMessage } from './helpers/factories'
import { jsonRequest, params } from './helpers/request'

const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z')
const at = (n: number) => new Date(BASE_MS + n * 1000)

type MessageJson = { id: string; subject: string; bodyText: string | null; categories?: string[] }

async function search(
  inboxId: string,
  token: string,
  query: string,
): Promise<{ status: number; messages: MessageJson[]; nextCursor: string | null; hasMore: boolean; message?: string }> {
  const res = await listAppMessages(
    jsonRequest(`http://localhost/api/app/emailInbox/${inboxId}/messages?${query}`, {
      credential: token,
    }),
    params({ id: inboxId }),
  )
  const body = await res.json()
  return { status: res.status, ...body.data, message: body.message }
}

/** Subjects of the matched messages, sorted so assertions do not depend on order. */
const subjects = (messages: MessageJson[]) => messages.map((m) => m.subject).sort()

describe('message search', () => {
  describe('full-text over subject and body', () => {
    it('matches a word in the subject', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'Your invoice is ready', createdAt: at(1) })
      await seedMessage(inbox.id, org.id, { subject: 'Weekly newsletter', createdAt: at(2) })

      const result = await search(inbox.id, token, 'q=invoice')

      expect(result.status).toBe(200)
      expect(subjects(result.messages)).toEqual(['Your invoice is ready'])
    })

    it('matches a word in the body', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, {
        subject: 'A', text: 'your parcel is out for delivery', bodyText: 'your parcel is out for delivery',
      })
      await seedMessage(inbox.id, org.id, { subject: 'B', text: 'nothing here', bodyText: 'nothing here' })

      const result = await search(inbox.id, token, 'q=parcel')

      expect(subjects(result.messages)).toEqual(['A'])
    })

    /**
     * The whole reason bodyText exists: an HTML-only email used to have its body
     * reachable only inside the html blob.
     */
    it('matches text extracted from an html-only message', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, {
        subject: 'Receipt',
        text: '',
        html: '<html><head><style>.promo{color:red}</style></head><body><p>Refund processed</p></body></html>',
        bodyText: 'Refund processed',
      })

      expect(subjects((await search(inbox.id, token, 'q=refund')).messages)).toEqual(['Receipt'])
    })

    it('does not match css that only appears in the html', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, {
        subject: 'Receipt',
        text: '',
        html: '<style>.promobanner{color:red}</style><p>Refund processed</p>',
        bodyText: 'Refund processed',
      })

      expect((await search(inbox.id, token, 'q=promobanner')).messages).toHaveLength(0)
    })

    it('stems, so a plural query matches a singular body', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'Your invoice is ready' })

      expect((await search(inbox.id, token, 'q=invoices')).messages).toHaveLength(1)
    })

    it('is case-insensitive', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'Your INVOICE is ready' })

      expect((await search(inbox.id, token, 'q=invoice')).messages).toHaveLength(1)
    })

    it('requires all terms, not any', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'invoice attached' })
      await seedMessage(inbox.id, org.id, { subject: 'receipt attached' })

      expect(subjects((await search(inbox.id, token, 'q=invoice+attached')).messages)).toEqual([
        'invoice attached',
      ])
    })

    it('supports quoted phrases', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'order confirmed today' })
      await seedMessage(inbox.id, org.id, { subject: 'confirmed your order' })

      const result = await search(inbox.id, token, `q=${encodeURIComponent('"order confirmed"')}`)

      expect(subjects(result.messages)).toEqual(['order confirmed today'])
    })

    it('supports negation', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'invoice paid' })
      await seedMessage(inbox.id, org.id, { subject: 'invoice refunded' })

      const result = await search(inbox.id, token, `q=${encodeURIComponent('invoice -refunded')}`)

      expect(subjects(result.messages)).toEqual(['invoice paid'])
    })

    /**
     * `to_tsquery` raises a syntax error on input like this, which would surface
     * as a 500 from a search box. `websearch_to_tsquery` is total.
     */
    it('does not error on punctuation a user might type', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'anything' })

      for (const q of ['&', '|', '!', ':*', '((', 'a & | b', "'"]) {
        const result = await search(inbox.id, token, `q=${encodeURIComponent(q)}`)
        expect(result.status).toBe(200)
      }
    })

    it('does not execute injected sql', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'still here' })

      const result = await search(
        inbox.id,
        token,
        `q=${encodeURIComponent("'; DROP TABLE email_messages; --")}`,
      )

      expect(result.status).toBe(200)
      expect(await prisma.emailMessage.count({ where: { inboxEmailAddressId: inbox.id } })).toBe(1)
    })
  })

  /**
   * The generated column is what keeps the index consistent without a trigger or
   * a backfill job — including when a row is updated after insert.
   */
  describe('the generated search vector', () => {
    it('indexes a message written through Prisma with no explicit vector', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'quarterly statement' })

      expect((await search(inbox.id, token, 'q=quarterly')).messages).toHaveLength(1)
    })

    it('re-indexes when the body is updated', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      const message = await seedMessage(inbox.id, org.id, { subject: 'A', bodyText: 'aardvark' })

      expect((await search(inbox.id, token, 'q=pelican')).messages).toHaveLength(0)

      await prisma.emailMessage.update({ where: { id: message.id }, data: { bodyText: 'pelican' } })

      expect((await search(inbox.id, token, 'q=pelican')).messages).toHaveLength(1)
      expect((await search(inbox.id, token, 'q=aardvark')).messages).toHaveLength(0)
    })

    /**
     * A consequence of the 'english' configuration that callers will hit: common
     * words carry no lexemes, so a query made only of them matches nothing rather
     * than everything. Pinned here because it is surprising, not because it is
     * wrong — it is the same behaviour every Postgres FTS deployment has.
     */
    it('matches nothing for a query made only of stop words', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'the invoice is here' })

      const result = await search(inbox.id, token, 'q=the+is')

      expect(result.status).toBe(200)
      expect(result.messages).toHaveLength(0)
    })

    /**
     * Rows predating the feature were deliberately not backfilled. They keep
     * bodyText NULL and fall back to `text`, so subject search covers everything
     * and body search covers everything that arrived with a text part.
     */
    it('falls back to text for rows with no derived bodyText', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, {
        subject: 'legacy', text: 'reservation confirmed', bodyText: null,
      })

      expect((await search(inbox.id, token, 'q=reservation')).messages).toHaveLength(1)
    })

    /**
     * Without the left() caps in the generated expression this INSERT fails with
     * "string is too long for tsvector" — the email is not merely unsearchable,
     * it cannot be stored at all.
     */
    it('ingests a body far larger than the tsvector limit', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      const huge = Array.from({ length: 300_000 }, (_, i) => `w${i}`).join(' ')

      await expect(
        seedMessage(inbox.id, org.id, { subject: 'huge', text: huge, bodyText: huge }),
      ).resolves.toBeTruthy()

      // Searchable on a term inside the retained prefix.
      expect((await search(inbox.id, token, 'q=w5')).messages).toHaveLength(1)
    })
  })

  describe('from', () => {
    it('matches a substring of the sender case-insensitively', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'A', from: 'Billing <billing@acme.com>' })
      await seedMessage(inbox.id, org.id, { subject: 'B', from: 'support@other.com' })

      expect(subjects((await search(inbox.id, token, 'from=BILLING')).messages)).toEqual(['A'])
    })

    it('matches the display name as well as the address', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'A', from: 'Acme Support <no-reply@x.com>' })

      expect((await search(inbox.id, token, 'from=Acme')).messages).toHaveLength(1)
    })

    /**
     * Unescaped, `from=%` is a filter that silently matches everything.
     */
    it('treats % as a literal, not a wildcard', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'A', from: 'a@b.com' })
      await seedMessage(inbox.id, org.id, { subject: 'B', from: '50%off@b.com' })

      expect(subjects((await search(inbox.id, token, 'from=%')).messages)).toEqual(['B'])
    })

    it('treats _ as a literal, not a single-character wildcard', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'A', from: 'ab@x.com' })
      await seedMessage(inbox.id, org.id, { subject: 'B', from: 'a_b@x.com' })

      expect(subjects((await search(inbox.id, token, 'from=a_b')).messages)).toEqual(['B'])
    })
  })

  describe('tags and categories', () => {
    it('matches any of the requested tags', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'A', tags: ['urgent'] })
      await seedMessage(inbox.id, org.id, { subject: 'B', tags: ['billing'] })
      await seedMessage(inbox.id, org.id, { subject: 'C', tags: ['other'] })

      expect(subjects((await search(inbox.id, token, 'tags=urgent,billing')).messages)).toEqual([
        'A', 'B',
      ])
    })

    it('matches tags exactly, not as a substring', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'A', tags: ['urgent-billing'] })

      expect((await search(inbox.id, token, 'tags=urgent')).messages).toHaveLength(0)
    })

    it('matches any of the requested categories', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'A', categories: ['receipt'] })
      await seedMessage(inbox.id, org.id, { subject: 'B', categories: ['newsletter'] })

      expect(subjects((await search(inbox.id, token, 'categories=receipt')).messages)).toEqual(['A'])
    })
  })

  describe('combining filters', () => {
    it('ANDs the filter kinds together', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, {
        subject: 'invoice ready', from: 'billing@acme.com', tags: ['urgent'],
      })
      await seedMessage(inbox.id, org.id, {
        subject: 'invoice ready', from: 'billing@acme.com', tags: ['later'],
      })
      await seedMessage(inbox.id, org.id, {
        subject: 'invoice ready', from: 'other@acme.com', tags: ['urgent'],
      })
      await seedMessage(inbox.id, org.id, {
        subject: 'newsletter', from: 'billing@acme.com', tags: ['urgent'],
      })

      const result = await search(inbox.id, token, 'q=invoice&from=billing&tags=urgent')

      expect(result.messages).toHaveLength(1)
    })
  })

  describe('scoping and safety', () => {
    it('never returns messages from another inbox', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      const other = await seedInbox(org.id, user.id)
      await seedMessage(other.id, org.id, { subject: 'invoice elsewhere' })

      expect((await search(inbox.id, token, 'q=invoice')).messages).toHaveLength(0)
    })

    /**
     * Raw SQL bypasses the soft-delete client extension, so this is the one read
     * path that would otherwise serve deleted mail.
     */
    it('never returns soft-deleted messages', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'invoice live' })
      await seedMessage(inbox.id, org.id, { subject: 'invoice gone', deletedAt: new Date() })

      expect(subjects((await search(inbox.id, token, 'q=invoice')).messages)).toEqual([
        'invoice live',
      ])
    })

    it('401s without a token', async () => {
      const { org, user } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)

      const res = await listAppMessages(
        jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages?q=invoice`),
        params({ id: inbox.id }),
      )

      expect(res.status).toBe(401)
    })
  })

  describe('ordering and pagination', () => {
    it('returns matches newest first', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      const a = await seedMessage(inbox.id, org.id, { subject: 'invoice one', createdAt: at(1) })
      const b = await seedMessage(inbox.id, org.id, { subject: 'invoice two', createdAt: at(2) })
      const c = await seedMessage(inbox.id, org.id, { subject: 'invoice three', createdAt: at(3) })

      const result = await search(inbox.id, token, 'q=invoice')

      expect(result.messages.map((m) => m.id)).toEqual([c.id, b.id, a.id])
    })

    it('paginates a filtered result set without skipping or repeating', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      for (let i = 1; i <= 5; i++) {
        await seedMessage(inbox.id, org.id, { subject: `invoice ${i}`, createdAt: at(i) })
        await seedMessage(inbox.id, org.id, { subject: `noise ${i}`, createdAt: at(i) })
      }

      const seen: string[] = []
      let cursor: string | null = null
      for (let page = 0; page < 5; page++) {
        const query = `q=invoice&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
        const result = await search(inbox.id, token, query)
        seen.push(...result.messages.map((m) => m.id))
        cursor = result.nextCursor
        if (!cursor) break
      }

      expect(seen).toHaveLength(5)
      expect(new Set(seen).size).toBe(5)
    })

    it('searches within a single thread, oldest first', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      const threadId = '00000000-0000-7000-8000-00000000aaaa'
      const a = await seedMessage(inbox.id, org.id, { subject: 'invoice a', threadId, createdAt: at(1) })
      const b = await seedMessage(inbox.id, org.id, { subject: 'invoice b', threadId, createdAt: at(2) })
      await seedMessage(inbox.id, org.id, { subject: 'invoice elsewhere', createdAt: at(3) })

      const result = await search(inbox.id, token, `q=invoice&threadId=${threadId}`)

      expect(result.messages.map((m) => m.id)).toEqual([a.id, b.id])
    })
  })

  describe('rejected requests', () => {
    it('400s when a search parameter is combined with grouped', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)

      const result = await search(inbox.id, token, 'q=invoice&grouped=true')

      expect(result.status).toBe(400)
      expect(result.message).toMatch(/grouped/i)
    })

    it('400s on an over-long query', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)

      expect((await search(inbox.id, token, `q=${'a'.repeat(201)}`)).status).toBe(400)
    })

    it('still serves the grouped view when no search parameter is present', async () => {
      const { org, user, token } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'A' })

      expect((await search(inbox.id, token, 'grouped=true')).status).toBe(200)
    })
  })

  /**
   * The two surfaces must accept the same parameters and mean the same thing by
   * them — they share one parser and one service precisely so this stays true.
   */
  describe('the v1 external API', () => {
    async function v1Search(inboxId: string, credential: string, query: string) {
      const res = await listV1Messages(
        jsonRequest(`http://localhost/api/v1/emailInbox/${inboxId}/messages?${query}`, {
          credential,
        }),
        params({ id: inboxId }),
      )
      const body = await res.json()
      return { status: res.status, ...body.data, message: body.message }
    }

    async function apiKeyFor(orgId: string, userId: string) {
      const { rawKey } = await createApiKey(orgId, userId, ['messages:read'])
      return rawKey
    }

    it('searches with the same parameters as the app API', async () => {
      const { org, user } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, { subject: 'Your invoice is ready' })
      await seedMessage(inbox.id, org.id, { subject: 'Weekly newsletter' })
      const key = await apiKeyFor(org.id, user.id)

      const result = await v1Search(inbox.id, key, 'q=invoice')

      expect(result.status).toBe(200)
      expect(subjects(result.messages)).toEqual(['Your invoice is ready'])
    })

    it('publishes bodyText and categories so a caller can read what it filtered on', async () => {
      const { org, user } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      await seedMessage(inbox.id, org.id, {
        subject: 'Receipt', text: '', html: '<p>Refund processed</p>',
        bodyText: 'Refund processed', categories: ['receipt'],
      })
      const key = await apiKeyFor(org.id, user.id)

      const result = await v1Search(inbox.id, key, 'categories=receipt')

      expect(result.messages[0].bodyText).toBe('Refund processed')
      expect(result.messages[0].categories).toEqual(['receipt'])
    })

    it('rejects grouped combined with search, exactly as the app API does', async () => {
      const { org, user } = await createOrgWithUser()
      const inbox = await seedInbox(org.id, user.id)
      const key = await apiKeyFor(org.id, user.id)

      const result = await v1Search(inbox.id, key, 'q=invoice&grouped=true')

      expect(result.status).toBe(400)
      expect(result.message).toMatch(/grouped/i)
    })
  })
})
