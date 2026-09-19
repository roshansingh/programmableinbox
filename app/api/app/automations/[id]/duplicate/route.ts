import { Prisma } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/db'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { withUser } from '@/lib/auth/with-auth'
import { parseAutomationConfig } from '@/lib/automations/serialization'
import { findForwardEmailDomainViolations } from '@/lib/automations/outbound-policy'
import { formatAutomationRecord, loadAutomationForUser } from '../../_utils'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withUser(async (request, principal, { params }: RouteContext) => {

  const { id } = await params
  const automation = await loadAutomationForUser(principal, id)
  if (!automation || !automation.activeRevision) {
    return jsonError('Not found', 404)
  }

  // POST/PATCH refuse a forward_email node targeting our own domain at save
  // time, but this route copies `activeRevision.config` verbatim rather than
  // going through either — without this check, an automation saved before
  // the rule existed (or whose target domain was added to
  // EMAIL_INBOX_ALLOWED_DOMAINS afterward) could be duplicated indefinitely
  // with the violation intact.
  const domainViolations = findForwardEmailDomainViolations(
    parseAutomationConfig(automation.activeRevision.config),
  )
  if (domainViolations.length > 0) {
    return jsonError(
      "Forward-email action cannot target an address on this service's own domain: " +
        domainViolations.flatMap((v) => v.addresses).join(', '),
      400,
    )
  }

  const duplicate = await prisma.automation.create({
    data: {
      organizationId: automation.organizationId,
      inboxId: automation.inboxId,
      name: `${automation.name} Copy`,
      description: automation.description,
      isActive: false,
      revisions: {
        create: {
          revision: 1,
          schemaVersion: automation.activeRevision.schemaVersion,
          config: automation.activeRevision.config as Prisma.InputJsonValue,
          layout: automation.activeRevision.layout as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined,
          createdByUserId: principal.userId,
        },
      },
    },
    include: {
      revisions: true,
    },
  })

  const revision = duplicate.revisions[0]
  const activated = await prisma.automation.update({
    where: { id: duplicate.id },
    data: { activeRevisionId: revision.id },
    include: {
      activeRevision: true,
      revisions: {
        orderBy: { revision: 'desc' },
        take: 10,
      },
    },
  })

  return jsonSuccess(formatAutomationRecord(activated), 201)
})
