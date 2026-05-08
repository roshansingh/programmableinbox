import { NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { runAutomationDryRun } from '@/lib/automations/dispatcher'
import { loadAutomationForUser, readJsonObject, requireAuthenticatedUser } from '../../_utils'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const auth = await requireAuthenticatedUser(request)
  if (auth.error) return auth.error

  const parsed = await readJsonObject(request)
  if (parsed.error) return parsed.error

  const { id } = await params
  const automation = await loadAutomationForUser(auth.user, id)
  if (!automation) return jsonError('Not found', 404)

  const limit =
    typeof parsed.body.limit === 'number' && parsed.body.limit > 0
      ? Math.min(parsed.body.limit, 50)
      : 10

  const results = await runAutomationDryRun(automation.id, limit)
  return jsonSuccess(results)
}
