import { NextRequest } from 'next/server'
import { Prisma } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/db'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { parseAutomationConfig, parseAutomationLayout } from '@/lib/automations/serialization'
import { validateAutomationGraph } from '@/lib/automations/validation'
import {
  formatAutomationRecord,
  loadAutomationForUser,
  readJsonObject,
  requireAuthenticatedUser,
} from '../_utils'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const auth = await requireAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { id } = await params
  const automation = await loadAutomationForUser(auth.user, id)
  if (!automation) return jsonError('Not found', 404)

  return jsonSuccess(formatAutomationRecord(automation))
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await requireAuthenticatedUser(request)
  if (auth.error) return auth.error

  const parsed = await readJsonObject(request)
  if (parsed.error) return parsed.error

  const { id } = await params
  const automation = await loadAutomationForUser(auth.user, id)
  if (!automation) return jsonError('Not found', 404)

  const shellData: Record<string, string | boolean | null> = {}
  if (typeof parsed.body.name === 'string') {
    const trimmedName = parsed.body.name.trim()
    if (!trimmedName) {
      return jsonError('name must not be empty', 400)
    }
    shellData.name = trimmedName
  }
  if (typeof parsed.body.description === 'string') shellData.description = parsed.body.description.trim()
  if (typeof parsed.body.isActive === 'boolean') shellData.isActive = parsed.body.isActive
  if (parsed.body.description === null) shellData.description = null

  const nextConfig = parsed.body.config ? parseAutomationConfig(parsed.body.config) : null
  const nextLayout = parsed.body.layout ? parseAutomationLayout(parsed.body.layout) : null
  const effectiveConfig =
    nextConfig ?? (automation.activeRevision ? parseAutomationConfig(automation.activeRevision.config) : null)

  if (shellData.isActive === true) {
    if (!effectiveConfig) {
      return jsonError('Automation must have a saved configuration before it can be started', 400)
    }

    const validation = validateAutomationGraph(effectiveConfig)
    if (!validation.canStart) {
      return jsonError(validation.issues[0]?.message ?? 'Automation is not ready to start', 400)
    }
  }

  let revisionId = automation.activeRevisionId
  if (nextConfig || nextLayout) {
    const latestRevision = automation.revisions[0]
    const revision = await prisma.automationRevision.create({
      data: {
        automationId: automation.id,
        revision: (latestRevision?.revision ?? 0) + 1,
        schemaVersion: (nextConfig ?? (automation.activeRevision && parseAutomationConfig(automation.activeRevision.config)))?.version ?? 1,
        config: (nextConfig ?? automation.activeRevision?.config ?? null) as Prisma.InputJsonValue,
        layout: (nextLayout ?? automation.activeRevision?.layout ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined,
        createdByUserId: auth.user.id,
      },
    })
    revisionId = revision.id
  }

  const updated = await prisma.automation.update({
    where: { id: automation.id },
    data: {
      ...shellData,
      activeRevisionId: revisionId,
    },
    include: {
      activeRevision: true,
      revisions: {
        orderBy: { revision: 'desc' },
        take: 10,
      },
    },
  })

  return jsonSuccess(formatAutomationRecord(updated))
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const auth = await requireAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { id } = await params
  const automation = await loadAutomationForUser(auth.user, id)
  if (!automation) return jsonError('Not found', 404)

  await prisma.automation.delete({
    where: { id: automation.id },
  })

  return new Response(null, { status: 204 })
}
