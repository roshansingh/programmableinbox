import { prisma } from '@/lib/db'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { withUser } from '@/lib/auth/with-auth'
import { executeAutomation } from '@/lib/automations/executor'
import {
  loadAutomationForUser,
  readJsonObject,
} from '../../_utils'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withUser(async (request, principal, { params }: RouteContext) => {

  const { id } = await params
  const automation = await loadAutomationForUser(principal, id)
  if (!automation) return jsonError('Not found', 404)

  const runs = await prisma.automationRun.findMany({
    where: { automationId: automation.id },
    include: {
      nodeRuns: true,
    },
    orderBy: { startedAt: 'desc' },
    take: 50,
  })

  return jsonSuccess(
    runs.map((run) => ({
      id: run.id,
      status: run.status,
      triggerType: run.triggerType,
      isDryRun: run.isDryRun,
      emailMessageId: run.emailMessageId,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      nodeRuns: run.nodeRuns.map((nodeRun) => ({
        id: nodeRun.id,
        configNodeId: nodeRun.configNodeId,
        configNodeType: nodeRun.configNodeType,
        status: nodeRun.status,
        branchTaken: nodeRun.branchTaken,
        startedAt: nodeRun.startedAt.toISOString(),
        finishedAt: nodeRun.finishedAt?.toISOString() ?? null,
      })),
    }))
  )
})

export const POST = withUser(async (request, principal, { params }: RouteContext) => {

  const parsed = await readJsonObject(request)
  if (parsed.error) return parsed.error

  const { id } = await params
  const automation = await loadAutomationForUser(principal, id)
  if (!automation || !automation.activeRevision) return jsonError('Not found', 404)

  const emailMessageId =
    typeof parsed.body.emailMessageId === 'string' ? parsed.body.emailMessageId : null
  if (!emailMessageId) return jsonError('emailMessageId is required', 400)

  const message = await prisma.emailMessage.findFirst({
    where: {
      id: emailMessageId,
      organizationId: automation.organizationId,
    },
    include: {
      inboxEmailAddress: true,
      attachments: true,
    },
  })

  if (!message) return jsonError('Email message not found', 404)

  const result = await executeAutomation({
    automation,
    revision: automation.activeRevision,
    message,
    inbox: message.inboxEmailAddress,
    attachments: message.attachments,
    isDryRun: Boolean(parsed.body.isDryRun),
  })

  return jsonSuccess(result, 201)
})
