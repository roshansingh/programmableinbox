import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { loadAutomationForUser, requireAuthenticatedUser } from '../../../_utils'

type RouteContext = { params: Promise<{ id: string; runId: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const auth = await requireAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { id, runId } = await params
  const automation = await loadAutomationForUser(auth.user, id)
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
}
