import { NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { sweepStuckAutomationRuns } from '@/lib/automations/sweeper'
import { config } from '@/lib/config'

export async function POST(request: NextRequest) {
  const expectedSecret = config.runtime.sweeperSecret
  if (!expectedSecret) {
    return jsonError('AUTOMATION_SWEEPER_SECRET not configured', 500)
  }

  const providedSecret = request.headers.get('x-automation-sweeper-secret')
  if (providedSecret !== expectedSecret) {
    return jsonError('Unauthorized', 401)
  }

  const count = await sweepStuckAutomationRuns()
  return jsonSuccess({ count: count.count })
}
