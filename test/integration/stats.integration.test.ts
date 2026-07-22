import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/v1/stats/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg, createApiKey } from './helpers/auth'
import { seedInbox, seedMessage, seedAutomation } from './helpers/factories'
import { jsonRequest } from './helpers/request'

describe('GET /api/v1/stats', () => {
  it('401 without a token', async () => {
    const res = await GET(jsonRequest('http://localhost/api/v1/stats'))
    expect(res.status).toBe(401)
  })

  it('returns counts scoped to the caller\'s org only, excluding a second org\'s data', async () => {
    const { org, user, token } = await createOrgWithUser()
    const other = await createSecondOrg()

    // Caller org: 2 inboxes, 3 messages (today), 1 api key, 1 active automation
    const inboxA1 = await seedInbox(org.id, user.id)
    const inboxA2 = await seedInbox(org.id, user.id)
    await seedMessage(inboxA1.id, org.id)
    await seedMessage(inboxA1.id, org.id)
    await seedMessage(inboxA2.id, org.id)
    await createApiKey(org.id, user.id, ['messages:read'])
    await seedAutomation(org.id, inboxA1.id)

    // Other org: 5 inboxes, 4 messages (today), 2 api keys, 3 active automations
    const inboxB1 = await seedInbox(other.org.id, other.user.id)
    await seedInbox(other.org.id, other.user.id)
    await seedInbox(other.org.id, other.user.id)
    await seedInbox(other.org.id, other.user.id)
    await seedInbox(other.org.id, other.user.id)
    await seedMessage(inboxB1.id, other.org.id)
    await seedMessage(inboxB1.id, other.org.id)
    await seedMessage(inboxB1.id, other.org.id)
    await seedMessage(inboxB1.id, other.org.id)
    await createApiKey(other.org.id, other.user.id, ['messages:read'])
    await createApiKey(other.org.id, other.user.id, ['messages:read'])
    await seedAutomation(other.org.id, inboxB1.id)
    await seedAutomation(other.org.id, inboxB1.id)
    await seedAutomation(other.org.id, inboxB1.id)

    const res = await GET(jsonRequest('http://localhost/api/v1/stats', { credential: token }))
    expect(res.status).toBe(200)
    const { data } = await res.json()

    expect(data).toEqual({
      emailInboxes: 2,
      emailsToday: 3,
      apiKeys: 1,
      activeAutomations: 1,
    })
  })

  it('emailsToday excludes messages created before today, in the same org', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(12, 0, 0, 0)

    await seedMessage(inbox.id, org.id, { createdAt: yesterday })
    await seedMessage(inbox.id, org.id) // today

    const res = await GET(jsonRequest('http://localhost/api/v1/stats', { credential: token }))
    expect(res.status).toBe(200)
    const { data } = await res.json()

    expect(data.emailInboxes).toBe(1)
    expect(data.emailsToday).toBe(1)
  })

  it('activeAutomations excludes an automation with no active revision', async () => {
    const { org, user, token } = await createOrgWithUser()
    await seedAutomation(org.id) // has an active revision -> counted

    await prisma.automation.create({
      data: { organizationId: org.id, name: 'draft-automation', activeRevisionId: null },
    })

    const res = await GET(jsonRequest('http://localhost/api/v1/stats', { credential: token }))
    expect(res.status).toBe(200)
    const { data } = await res.json()

    expect(data.activeAutomations).toBe(1)
  })

  it('emailInboxes excludes soft-deleted inboxes', async () => {
    const { org, user, token } = await createOrgWithUser()
    await seedInbox(org.id, user.id)
    const deleted = await seedInbox(org.id, user.id)
    await prisma.emailInbox.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } })

    const res = await GET(jsonRequest('http://localhost/api/v1/stats', { credential: token }))
    expect(res.status).toBe(200)
    const { data } = await res.json()

    expect(data.emailInboxes).toBe(1)
  })
})
