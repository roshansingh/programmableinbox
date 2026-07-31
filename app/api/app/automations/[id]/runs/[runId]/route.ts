import { prisma } from '@/lib/db'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { withUser } from '@/lib/auth/with-auth'
import { loadAutomationForUser } from '../../../_utils'

type RouteContext = { params: Promise<{ id: string; runId: string }> }

export const GET = withUser(async (request, principal, { params }: RouteContext) => {

  const { id, runId } = await params
  const automation = await loadAutomationForUser(principal, id)
  if (!automation) return jsonError('Not found', 404)

  const run = await prisma.automationRun.findFirst({
    where: {
      id: runId,
      automationId: automation.id,
    },
    include: {
      nodeRuns: true,
    },
  })

  if (!run) return jsonError('Not found', 404)

  return jsonSuccess({
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
      input: nodeRun.input,
      output: nodeRun.output,
      error: nodeRun.error,
      startedAt: nodeRun.startedAt.toISOString(),
      finishedAt: nodeRun.finishedAt?.toISOString() ?? null,
    })),
  })
})
