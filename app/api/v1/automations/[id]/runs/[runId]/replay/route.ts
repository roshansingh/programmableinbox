import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { replayAutomationRun } from '@/lib/automations/dispatcher'
import { loadAutomationForUser, requireAuthenticatedUser } from '../../../../_utils'

type RouteContext = { params: Promise<{ id: string; runId: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
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
  })

  if (!run) return jsonError('Not found', 404)

  const result = await replayAutomationRun(run.id)
  return jsonSuccess(result, 201)
}
