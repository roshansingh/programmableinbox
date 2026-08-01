import { NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { config } from '@/lib/config'
import { sweepStuckAutomationRuns } from '@/lib/automations/sweeper'

export async function POST(request: NextRequest) {
  const expectedSecret = config.security.automationSweeperSecret
  if (!expectedSecret) {
    return jsonError('AUTOMATION_SWEEPER_SECRET not configured', 500)
  }

  const providedSecret = request.headers.get('x-automation-sweeper-secret')
  if (providedSecret !== expectedSecret.reveal()) {
    return jsonError('Unauthorized', 401)
  }

  const count = await sweepStuckAutomationRuns()
  return jsonSuccess({ count: count.count })
}
