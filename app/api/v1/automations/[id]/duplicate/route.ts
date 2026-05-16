import { NextRequest } from 'next/server'
import { Prisma } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/db'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { formatAutomationRecord, loadAutomationForUser, requireAuthenticatedUser } from '../../_utils'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const auth = await requireAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { id } = await params
  const automation = await loadAutomationForUser(auth.user, id)
  if (!automation || !automation.activeRevision) {
    return jsonError('Not found', 404)
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
          createdByUserId: auth.user.id,
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
}
