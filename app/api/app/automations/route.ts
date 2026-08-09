import { prisma } from '@/lib/db'
import { jsonError, jsonSuccess, jsonPlanDenial } from '@/lib/api-helpers'
import { checkResourceLimit } from '@/lib/commercial/enforce'
import { CommercialProvider } from '@/lib/commercial/provider'
import { withUser } from '@/lib/auth/with-auth'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'
import { parseAutomationConfig, parseAutomationLayout } from '@/lib/automations/serialization'
import { MAX_UNPAGINATED_ROWS } from '@/lib/pagination/params'
import {
  formatAutomationRecord,
  readJsonObject,
  requireOrganizationMembership,
} from './_utils'

export const GET = withUser(async (request, principal) => {

  const organizationId = request.nextUrl.searchParams.get('organizationId')
  if (organizationId) {
    const scoped = requireOrganizationMembership(principal, organizationId)
    if (scoped.error) return scoped.error
  }

  const orgIds = organizationId
    ? [organizationId]
    : principal.memberships.map((membership) => membership.organizationId)

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
    // This endpoint exposes no pagination params; the ceiling is purely a guard
    // against one request materialising an unbounded result set.
    take: MAX_UNPAGINATED_ROWS,
  })

  return jsonSuccess(automations.map(formatAutomationRecord))
})

export const POST = withUser(async (request, principal) => {

  const parsed = await readJsonObject(request)
  if (parsed.error) return parsed.error

  const organizationId =
    typeof parsed.body.organizationId === 'string' ? parsed.body.organizationId : null
  const scoped = requireOrganizationMembership(principal, organizationId)
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

  // Plan gates, after the config and layout are judged so a malformed
  // automation stays a 400 rather than being reported as a billing problem.
  const plan = await CommercialProvider.plans.resolve(scoped.organizationId)
  if (!plan.limits.automationsEnabled) {
    return jsonPlanDenial({
      message: `Automations are not included in your ${plan.planName} plan.`,
      status: 402,
      limit: 0,
      used: 0,
      planCode: plan.planCode,
    })
  }

  const denial = await checkResourceLimit(scoped.organizationId, 'automations', 'automation', () =>
    prisma.automation.count({ where: { organizationId: scoped.organizationId } }),
  )
  if (denial) return jsonPlanDenial(denial)

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
          createdByUserId: principal.userId,
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
})
