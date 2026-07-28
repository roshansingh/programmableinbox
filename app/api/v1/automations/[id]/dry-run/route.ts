import { NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { runAutomationDryRun } from '@/lib/automations/dispatcher'
import { clampLimit } from '@/lib/pagination/params'
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

  // Dry runs execute the whole automation per message, so they keep the tighter
  // ceiling of 50 rather than the MAX_LIMIT of 100 used by read-only lists.
  const limit = clampLimit(parsed.body.limit, { defaultLimit: 10, maxLimit: 50 })

  const results = await runAutomationDryRun(automation.id, limit)
  return jsonSuccess(results)
}
