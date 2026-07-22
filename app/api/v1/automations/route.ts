import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'
import { parseAutomationConfig, parseAutomationLayout } from '@/lib/automations/serialization'
import {
  formatAutomationRecord,
  readJsonObject,
  requireAuthenticatedUser,
  requireOrganizationMembership,
} from './_utils'

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request)
  if (auth.error) return auth.error

  const organizationId = request.nextUrl.searchParams.get('organizationId')
  if (organizationId) {
    const scoped = requireOrganizationMembership(auth.user, organizationId)
    if (scoped.error) return scoped.error
  }

  const orgIds = organizationId
    ? [organizationId]
    : auth.user.memberships.map((membership) => membership.organizationId)

  const automations = await prisma.automation.findMany({
    where: {
      organizationId: { in: orgIds },
    },
    include: {
      activeRevision: true,
      revisions: {
        orderBy: { revision: 'desc' },
        take: 10,
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return jsonSuccess(automations.map(formatAutomationRecord))
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request)
  if (auth.error) return auth.error

  const parsed = await readJsonObject(request)
  if (parsed.error) return parsed.error

  const organizationId =
    typeof parsed.body.organizationId === 'string' ? parsed.body.organizationId : null
  const scoped = requireOrganizationMembership(auth.user, organizationId)
  if (scoped.error) return scoped.error

  const name = typeof parsed.body.name === 'string' && parsed.body.name.trim() ? parsed.body.name.trim() : null
  if (!name) {
    return jsonError('name is required', 400)
  }

  const description =
    typeof parsed.body.description === 'string' && parsed.body.description.trim()
      ? parsed.body.description.trim()
      : null

  const inboxId = typeof parsed.body.inboxId === 'string' ? parsed.body.inboxId : null
  if (inboxId) {
    const inbox = await prisma.emailInbox.findFirst({
      where: { id: inboxId, organizationId: scoped.organizationId },
    })
    if (!inbox) return jsonError('Inbox not found', 404)
  }

  let config
  try {
    config = parsed.body.config ? parseAutomationConfig(parsed.body.config) : createDefaultAutomationConfig()
  } catch {
    return jsonError('Invalid automation config', 400)
  }

  let layout
  try {
    layout = parsed.body.layout ? parseAutomationLayout(parsed.body.layout) : createDefaultAutomationLayout(config)
  } catch {
    return jsonError('Invalid automation layout', 400)
  }

  const created = await prisma.automation.create({
    data: {
      organizationId: scoped.organizationId,
      inboxId,
      name,
      description,
      isActive: false,
      revisions: {
        create: {
          revision: 1,
          schemaVersion: config.version,
          config,
          layout,
          createdByUserId: auth.user.id,
        },
      },
    },
    include: {
      revisions: true,
    },
  })

  const revision = created.revisions[0]
  const finalized = await prisma.automation.update({
    where: { id: created.id },
    data: {
      activeRevisionId: revision.id,
    },
    include: {
      activeRevision: true,
      revisions: {
        orderBy: { revision: 'desc' },
        take: 10,
      },
    },
  })

  return jsonSuccess(formatAutomationRecord(finalized), 201)
}
