import { describe, it, expect } from 'vitest'
import { GET, POST } from '@/app/api/app/automations/route'
import { GET as getById, PATCH as patchById, DELETE as deleteById } from '@/app/api/app/automations/[id]/route'
import { POST as duplicatePost } from '@/app/api/app/automations/[id]/duplicate/route'
import { POST as activateRevisionPost } from '@/app/api/app/automations/[id]/activate-revision/route'
import { prisma } from '@/lib/db'
import { createDefaultAutomationConfig } from '@/lib/automations/definitions'
import { AUTOMATION_SCHEMA_VERSION } from '@/lib/automations/types'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'
import { seedAutomation, seedInbox } from './helpers/factories'
import { jsonRequest, params } from './helpers/request'

describe('POST /api/app/automations', () => {
  it('401 without a token', async () => {
    const res = await POST(jsonRequest('http://localhost/api/app/automations', { method: 'POST', body: {} }))
    expect(res.status).toBe(401)
  })

  it('400 without organizationId', async () => {
    const { token } = await createOrgWithUser()
    const res = await POST(jsonRequest('http://localhost/api/app/automations', {
      method: 'POST', credential: token,
      body: { name: 'No Org' },
    }))
    expect(res.status).toBe(400)
  })

  it('403 creating in an org you do not belong to', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const res = await POST(jsonRequest('http://localhost/api/app/automations', {
      method: 'POST', credential: token,
      body: { organizationId: other.org.id, name: 'Nope' },
    }))
    expect(res.status).toBe(403)
  })

  it('400 without a name', async () => {
    const { org, token } = await createOrgWithUser()
    const res = await POST(jsonRequest('http://localhost/api/app/automations', {
      method: 'POST', credential: token,
      body: { organizationId: org.id },
    }))
    expect(res.status).toBe(400)
  })

  it('404 when inboxId does not resolve inside the org', async () => {
    const { org, token } = await createOrgWithUser()
    const res = await POST(jsonRequest('http://localhost/api/app/automations', {
      method: 'POST', credential: token,
      body: { organizationId: org.id, name: 'Bad Inbox', inboxId: '00000000-0000-7000-8000-000000000000' },
    }))
    expect(res.status).toBe(404)
  })

  it('creates an automation with a default config and an active initial revision, and persists both rows', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)

    const res = await POST(jsonRequest('http://localhost/api/app/automations', {
      method: 'POST', credential: token,
      body: { organizationId: org.id, name: '  My Automation  ', description: '  desc  ', inboxId: inbox.id },
    }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.name).toBe('My Automation')
    expect(data.description).toBe('desc')
    expect(data.organizationId).toBe(org.id)
    expect(data.inboxId).toBe(inbox.id)
    expect(data.isActive).toBe(false)
    expect(data.status).toBe('draft')
    expect(data.activeRevisionId).toBeTruthy()
    expect(data.activeRevisionNumber).toBe(1)
    expect(data.schemaVersion).toBe(AUTOMATION_SCHEMA_VERSION)
    expect(data.revisions).toHaveLength(1)

    // Automation row.
    const automationRow = await prisma.automation.findUniqueOrThrow({ where: { id: data.id } })
    expect(automationRow.organizationId).toBe(org.id)
    expect(automationRow.inboxId).toBe(inbox.id)
    expect(automationRow.isActive).toBe(false)
    expect(automationRow.activeRevisionId).toBe(data.activeRevisionId)

    // Initial revision row.
    const revisionRow = await prisma.automationRevision.findFirstOrThrow({ where: { automationId: data.id } })
    expect(revisionRow.id).toBe(data.activeRevisionId)
    expect(revisionRow.revision).toBe(1)
    expect(revisionRow.schemaVersion).toBe(AUTOMATION_SCHEMA_VERSION)
    expect(revisionRow.config).toEqual(createDefaultAutomationConfig())
    expect(revisionRow.createdByUserId).toBe(user.id)

    const revisionCount = await prisma.automationRevision.count({ where: { automationId: data.id } })
    expect(revisionCount).toBe(1)
  })

  it('accepts an explicit config instead of the default', async () => {
    const { org, token } = await createOrgWithUser()
    const config = createDefaultAutomationConfig()
    config.settings.priority = 42

    const res = await POST(jsonRequest('http://localhost/api/app/automations', {
      method: 'POST', credential: token,
      body: { organizationId: org.id, name: 'Custom Config', config },
    }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.config.settings.priority).toBe(42)

    const revisionRow = await prisma.automationRevision.findFirstOrThrow({ where: { automationId: data.id } })
    expect((revisionRow.config as { settings: { priority: number } }).settings.priority).toBe(42)
  })
})

describe('GET /api/app/automations', () => {
  it('401 without a token', async () => {
    const res = await GET(jsonRequest('http://localhost/api/app/automations'))
    expect(res.status).toBe(401)
  })

  it('lists only the caller\'s own org\'s automations, not another org\'s', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation: mine1 } = await seedAutomation(org.id)
    const { automation: mine2 } = await seedAutomation(org.id)

    const other = await createSecondOrg()
    await seedAutomation(other.org.id)

    const res = await GET(jsonRequest('http://localhost/api/app/automations', { credential: token }))
    expect(res.status).toBe(200)
    const { data } = await res.json()

    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(2)
    const ids = data.map((a: { id: string }) => a.id).sort()
    expect(ids).toEqual([mine1.id, mine2.id].sort())
  })

  it('filters by organizationId query param when the caller is a member', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation } = await seedAutomation(org.id)

    const res = await GET(jsonRequest(`http://localhost/api/app/automations?organizationId=${org.id}`, { credential: token }))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(automation.id)
  })

  it('403 filtering by an organizationId the caller does not belong to', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()

    const res = await GET(jsonRequest(`http://localhost/api/app/automations?organizationId=${other.org.id}`, { credential: token }))
    expect(res.status).toBe(403)
  })
})

describe('GET /api/app/automations/[id]', () => {
  it('401 without a token', async () => {
    const res = await getById(
      jsonRequest('http://localhost/api/app/automations/some-id'),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('gets the caller\'s own automation', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation, revision } = await seedAutomation(org.id)

    const res = await getById(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}`, { credential: token }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.id).toBe(automation.id)
    expect(data.activeRevisionId).toBe(revision.id)
  })

  it('404 getting another org\'s automation', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const { automation: theirs } = await seedAutomation(other.org.id)

    const res = await getById(
      jsonRequest(`http://localhost/api/app/automations/${theirs.id}`, { credential: token }),
      params({ id: theirs.id })
    )
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/app/automations/[id]', () => {
  it('401 without a token', async () => {
    const res = await patchById(
      jsonRequest('http://localhost/api/app/automations/some-id', { method: 'PATCH', body: {} }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('updates name, description, and isActive on the caller\'s own automation', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation } = await seedAutomation(org.id, undefined, { isActive: false })

    const res = await patchById(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}`, {
        method: 'PATCH', credential: token,
        body: { name: 'Renamed', description: 'new desc', isActive: true },
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.name).toBe('Renamed')
    expect(data.description).toBe('new desc')
    expect(data.isActive).toBe(true)
    expect(data.status).toBe('active')

    const row = await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } })
    expect(row.name).toBe('Renamed')
    expect(row.description).toBe('new desc')
    expect(row.isActive).toBe(true)
  })

  it('400 setting isActive true without a startable config', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation } = await seedAutomation(org.id, undefined, { isActive: false })
    // Overwrite the active revision's config with something that cannot start
    // (no reachable action) to exercise the canStart gate.
    await prisma.automationRevision.update({
      where: { id: (await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } })).activeRevisionId! },
      data: { config: { ...createDefaultAutomationConfig(), edges: [] } },
    })

    const res = await patchById(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}`, {
        method: 'PATCH', credential: token,
        body: { isActive: true },
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(400)
  })

  it('400 on an empty name', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation } = await seedAutomation(org.id)

    const res = await patchById(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}`, {
        method: 'PATCH', credential: token,
        body: { name: '   ' },
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(400)
  })

  it('creates a new revision and repoints activeRevisionId when config changes', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation, revision: firstRevision } = await seedAutomation(org.id)

    const newConfig = createDefaultAutomationConfig()
    newConfig.settings.priority = 7

    const res = await patchById(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}`, {
        method: 'PATCH', credential: token,
        body: { config: newConfig },
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.config.settings.priority).toBe(7)
    expect(data.activeRevisionId).not.toBe(firstRevision.id)
    expect(data.activeRevisionNumber).toBe(2)
    expect(data.revisions).toHaveLength(2)

    const row = await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } })
    expect(row.activeRevisionId).toBe(data.activeRevisionId)

    const revisionCount = await prisma.automationRevision.count({ where: { automationId: automation.id } })
    expect(revisionCount).toBe(2)

    const newRevisionRow = await prisma.automationRevision.findUniqueOrThrow({ where: { id: data.activeRevisionId } })
    expect(newRevisionRow.revision).toBe(2)
    expect((newRevisionRow.config as { settings: { priority: number } }).settings.priority).toBe(7)

    // Original revision row is untouched, not overwritten.
    const oldRevisionRow = await prisma.automationRevision.findUniqueOrThrow({ where: { id: firstRevision.id } })
    expect((oldRevisionRow.config as { settings: { priority: number } }).settings.priority).toBe(100)
  })

  it('404 updating another org\'s automation, and does not modify it', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const { automation: theirs } = await seedAutomation(other.org.id)

    const res = await patchById(
      jsonRequest(`http://localhost/api/app/automations/${theirs.id}`, {
        method: 'PATCH', credential: token,
        body: { name: 'Hijacked' },
      }),
      params({ id: theirs.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.automation.findUniqueOrThrow({ where: { id: theirs.id } })
    expect(row.name).not.toBe('Hijacked')
  })
})

describe('DELETE /api/app/automations/[id]', () => {
  it('401 without a token', async () => {
    const res = await deleteById(
      jsonRequest('http://localhost/api/app/automations/some-id', { method: 'DELETE' }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('soft-deletes the automation: sets deletedAt, hides it from GET/list, but keeps revisions', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation } = await seedAutomation(org.id)

    const res = await deleteById(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}`, { method: 'DELETE', credential: token }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(204)

    const row = await prisma.automation.findFirst({ where: { id: automation.id, deletedAt: { not: null } } })
    expect(row).not.toBeNull()
    expect(row!.deletedAt).not.toBeNull()

    // Revisions are left intact (F8: auditable run history).
    const revisionCount = await prisma.automationRevision.count({ where: { automationId: automation.id } })
    expect(revisionCount).toBe(1)

    // Disappears from GET by id (soft-delete filter applied on read).
    const getRes = await getById(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}`, { credential: token }),
      params({ id: automation.id })
    )
    expect(getRes.status).toBe(404)

    // Disappears from the list too.
    const listRes = await GET(jsonRequest('http://localhost/api/app/automations', { credential: token }))
    const { data } = await listRes.json()
    expect(data.find((a: { id: string }) => a.id === automation.id)).toBeUndefined()
  })

  it('404 deleting another org\'s automation, and does not soft-delete it', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const { automation: theirs } = await seedAutomation(other.org.id)

    const res = await deleteById(
      jsonRequest(`http://localhost/api/app/automations/${theirs.id}`, { method: 'DELETE', credential: token }),
      params({ id: theirs.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.automation.findUniqueOrThrow({ where: { id: theirs.id } })
    expect(row.deletedAt).toBeNull()
  })
})

describe('POST /api/app/automations/[id]/duplicate', () => {
  it('401 without a token', async () => {
    const res = await duplicatePost(
      jsonRequest('http://localhost/api/app/automations/some-id/duplicate', { method: 'POST', body: {} }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('clones the automation and its active revision with new ids and copied config', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    const { automation, revision } = await seedAutomation(org.id, inbox.id, { name: 'Original', description: 'orig desc' })

    const res = await duplicatePost(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}/duplicate`, { method: 'POST', credential: token }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(201)
    const { data } = await res.json()

    // New ids throughout.
    expect(data.id).not.toBe(automation.id)
    expect(data.activeRevisionId).not.toBe(revision.id)

    expect(data.name).toBe('Original Copy')
    expect(data.description).toBe('orig desc')
    expect(data.organizationId).toBe(org.id)
    expect(data.inboxId).toBe(inbox.id)
    expect(data.isActive).toBe(false)
    expect(data.config).toEqual(createDefaultAutomationConfig())

    // DB: new automation row with its own revision row, distinct from the original.
    const dupAutomationRow = await prisma.automation.findUniqueOrThrow({ where: { id: data.id } })
    expect(dupAutomationRow.id).not.toBe(automation.id)
    expect(dupAutomationRow.activeRevisionId).toBe(data.activeRevisionId)

    const dupRevisionRow = await prisma.automationRevision.findUniqueOrThrow({ where: { id: data.activeRevisionId } })
    expect(dupRevisionRow.automationId).toBe(data.id)
    expect(dupRevisionRow.revision).toBe(1)
    expect(dupRevisionRow.config).toEqual(revision.config)

    // Original is untouched.
    const originalRow = await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } })
    expect(originalRow.activeRevisionId).toBe(revision.id)
    const originalRevisionCount = await prisma.automationRevision.count({ where: { automationId: automation.id } })
    expect(originalRevisionCount).toBe(1)
  })

  it('404 duplicating another org\'s automation', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const { automation: theirs } = await seedAutomation(other.org.id)

    const res = await duplicatePost(
      jsonRequest(`http://localhost/api/app/automations/${theirs.id}/duplicate`, { method: 'POST', credential: token }),
      params({ id: theirs.id })
    )
    expect(res.status).toBe(404)

    const dupCount = await prisma.automation.count({ where: { organizationId: theirs.organizationId } })
    expect(dupCount).toBe(1)
  })
})

describe('POST /api/app/automations/[id]/activate-revision', () => {
  it('401 without a token', async () => {
    const res = await activateRevisionPost(
      jsonRequest('http://localhost/api/app/automations/some-id/activate-revision', { method: 'POST', body: {} }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('400 without a revisionId', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation } = await seedAutomation(org.id, undefined, { isActive: false })

    const res = await activateRevisionPost(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}/activate-revision`, {
        method: 'POST', credential: token, body: {},
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(400)
  })

  it('sets activeRevisionId to a different existing revision of the same automation', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation, revision: firstRevision } = await seedAutomation(org.id, undefined, { isActive: false })

    const secondConfig = createDefaultAutomationConfig()
    secondConfig.settings.priority = 55
    const secondRevision = await prisma.automationRevision.create({
      data: {
        automationId: automation.id,
        revision: 2,
        schemaVersion: secondConfig.version,
        config: secondConfig,
      },
    })

    const res = await activateRevisionPost(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}/activate-revision`, {
        method: 'POST', credential: token, body: { revisionId: secondRevision.id },
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.activeRevisionId).toBe(secondRevision.id)
    expect(data.activeRevisionNumber).toBe(2)
    expect(data.config.settings.priority).toBe(55)

    const row = await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } })
    expect(row.activeRevisionId).toBe(secondRevision.id)
    expect(row.activeRevisionId).not.toBe(firstRevision.id)
  })

  it('404 for a nonexistent revisionId', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation } = await seedAutomation(org.id, undefined, { isActive: false })

    const res = await activateRevisionPost(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}/activate-revision`, {
        method: 'POST', credential: token, body: { revisionId: '00000000-0000-7000-8000-000000000000' },
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } })
    expect(row.activeRevisionId).not.toBe('00000000-0000-7000-8000-000000000000')
  })

  it('404 for a revision that belongs to a different automation (foreign revision)', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation } = await seedAutomation(org.id, undefined, { isActive: false })
    const { revision: foreignRevision } = await seedAutomation(org.id, undefined, { isActive: false })

    const res = await activateRevisionPost(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}/activate-revision`, {
        method: 'POST', credential: token, body: { revisionId: foreignRevision.id },
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } })
    expect(row.activeRevisionId).not.toBe(foreignRevision.id)
  })

  it('400 activating a revision with a non-startable config while the automation is active', async () => {
    const { org, token } = await createOrgWithUser()
    const { automation } = await seedAutomation(org.id, undefined, { isActive: true })

    const badRevision = await prisma.automationRevision.create({
      data: {
        automationId: automation.id,
        revision: 2,
        schemaVersion: AUTOMATION_SCHEMA_VERSION,
        config: { nodes: [], edges: [] },
      },
    })

    const res = await activateRevisionPost(
      jsonRequest(`http://localhost/api/app/automations/${automation.id}/activate-revision`, {
        method: 'POST', credential: token, body: { revisionId: badRevision.id },
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(400)

    const row = await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } })
    expect(row.activeRevisionId).not.toBe(badRevision.id)
  })

  it('404 activating a revision on another org\'s automation', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const { automation: theirs, revision: theirRevision } = await seedAutomation(other.org.id, undefined, { isActive: false })

    const res = await activateRevisionPost(
      jsonRequest(`http://localhost/api/app/automations/${theirs.id}/activate-revision`, {
        method: 'POST', credential: token, body: { revisionId: theirRevision.id },
      }),
      params({ id: theirs.id })
    )
    expect(res.status).toBe(404)
  })
})
