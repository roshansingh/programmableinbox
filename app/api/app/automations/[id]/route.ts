import { NextRequest } from 'next/server'
import { Prisma } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/db'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { withUser } from '@/lib/auth/with-auth'
import { parseAutomationConfig, parseAutomationLayout } from '@/lib/automations/serialization'
import { validateAutomationGraph } from '@/lib/automations/validation'
import {
  formatAutomationRecord,
  loadAutomationForUser,
  readJsonObject,
} from '../_utils'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withUser(async (request, principal, { params }: RouteContext) => {

  const { id } = await params
  const automation = await loadAutomationForUser(principal, id)
  if (!automation) return jsonError('Not found', 404)

  return jsonSuccess(formatAutomationRecord(automation))
})

export const PATCH = withUser(async (request, principal, { params }: RouteContext) => {

  const parsed = await readJsonObject(request)
  if (parsed.error) return parsed.error

  const { id } = await params
  const automation = await loadAutomationForUser(principal, id)
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

  let nextConfig
  let nextLayout
  let effectiveConfig
  try {
    nextConfig = parsed.body.config ? parseAutomationConfig(parsed.body.config) : null
    nextLayout = parsed.body.layout ? parseAutomationLayout(parsed.body.layout) : null
    effectiveConfig =
      nextConfig ?? (automation.activeRevision ? parseAutomationConfig(automation.activeRevision.config) : null)
  } catch {
    return jsonError('Invalid automation config or layout', 400)
  }

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
        createdByUserId: principal.userId,
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
})

export const DELETE = withUser(async (request, principal, { params }: RouteContext) => {

  const { id } = await params
  const automation = await loadAutomationForUser(principal, id)
  if (!automation) return jsonError('Not found', 404)

  // Soft delete (F8). Revisions and run history are left intact rather than
  // cascaded away, so a deleted automation's runs remain auditable.
  await prisma.automation.update({
    where: { id: automation.id },
    data: { deletedAt: new Date() },
  })

  return new Response(null, { status: 204 })
})
