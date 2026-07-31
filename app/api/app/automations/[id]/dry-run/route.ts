import { NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { withUser } from '@/lib/auth/with-auth'
import { runAutomationDryRun } from '@/lib/automations/dispatcher'
import { clampLimit } from '@/lib/pagination/params'
import { loadAutomationForUser, readJsonObject } from '../../_utils'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withUser(async (request, principal, { params }: RouteContext) => {

  const parsed = await readJsonObject(request)
  if (parsed.error) return parsed.error

  const { id } = await params
  const automation = await loadAutomationForUser(principal, id)
  if (!automation) return jsonError('Not found', 404)

  // Dry runs execute the whole automation per message, so they keep the tighter
  // ceiling of 50 rather than the MAX_LIMIT of 100 used by read-only lists.
  const limit = clampLimit(parsed.body.limit, { defaultLimit: 10, maxLimit: 50 })

  const results = await runAutomationDryRun(automation.id, limit)
  return jsonSuccess(results)
})
