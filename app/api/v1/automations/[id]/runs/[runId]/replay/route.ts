import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { replayAutomationRun } from '@/lib/automations/dispatcher'
import { consumeReplayRateLimit, type ReplayMode } from '@/lib/automations/replay-rate-limit'
import logger from '@/lib/logger'
import { loadAutomationForUser, requireAuthenticatedUser } from '../../../../_utils'

type RouteContext = { params: Promise<{ id: string; runId: string }> }

/**
 * Replay is DRY-RUN BY DEFAULT (security issue #40).
 *
 * A live replay re-fires the run's real side effects (outbound webhook `fetch`,
 * forwarded email, auto-reply), so it must be requested explicitly and
 * unambiguously in the body:
 *
 *   {}                                  -> dry run
 *   { "mode": "dry_run" }               -> dry run
 *   { "mode": "live", "confirm": true } -> live
 *
 * The stored run's `isDryRun` flag is deliberately NOT consulted: deriving
 * liveness from it is exactly the bug this endpoint had.
 */
type ParsedReplayRequest =
  | { mode: ReplayMode; error?: never }
  | { mode?: never; error: Response }

async function parseReplayRequest(request: NextRequest): Promise<ParsedReplayRequest> {
  // An empty body is a valid request (and is what the UI's dry-run button
  // sends), so `request.json()` — which throws on "" — cannot be used directly.
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return { error: jsonError('Invalid request body', 400) }
  }

  let body: Record<string, unknown> = {}
  if (raw.trim().length > 0) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { error: jsonError('Invalid JSON body', 400) }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: jsonError('Request body must be a JSON object', 400) }
    }
    body = parsed as Record<string, unknown>
  }

  // Reject the legacy flag loudly instead of silently downgrading a caller that
  // meant to run for real.
  if ('isDryRun' in body) {
    return {
      error: jsonError(
        'isDryRun is not accepted on replay. Replay defaults to a dry run; ' +
          'for a live replay send { "mode": "live", "confirm": true }.',
        400
      ),
    }
  }

  // Only an *absent* `mode` defaults. An explicit `null` is a client bug (a
  // variable that did not hold what the caller thought), so it is rejected like
  // any other invalid value rather than silently becoming a dry run — the same
  // reasoning as the `isDryRun` rejection above.
  const rawMode = 'mode' in body && body.mode !== undefined ? body.mode : 'dry_run'
  if (rawMode !== 'dry_run' && rawMode !== 'live') {
    return { error: jsonError('mode must be "dry_run" or "live"', 400) }
  }

  if (rawMode === 'live' && body.confirm !== true) {
    return {
      error: jsonError(
        'A live replay re-executes real side effects and requires explicit ' +
          'confirmation: send { "mode": "live", "confirm": true }.',
        400
      ),
    }
  }

  return { mode: rawMode }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const auth = await requireAuthenticatedUser(request)
  if (auth.error) return auth.error

  const parsed = await parseReplayRequest(request)
  if (parsed.error) return parsed.error
  const mode = parsed.mode
  const isDryRun = mode === 'dry_run'

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

  // Rate limit only after auth + tenant scoping, so an attacker cannot burn a
  // victim's budget by guessing ids.
  const decision = await consumeReplayRateLimit({
    userId: auth.user.id,
    automationId: automation.id,
    mode,
  })

  if (!decision.allowed) {
    if (decision.reason === 'limit_exceeded') {
      logger.warn(
        {
          userId: auth.user.id,
          automationId: automation.id,
          runId: run.id,
          mode,
          scope: decision.scope,
          limit: decision.limit,
        },
        'Automation replay rate limit exceeded'
      )
      const response = jsonError(
        `Replay rate limit exceeded for this ${decision.scope} ` +
          `(${decision.limit} ${mode} replays per ${decision.windowSeconds}s). Retry later.`,
        429
      )
      response.headers.set('Retry-After', String(decision.retryAfterSeconds))
      return response
    }

    // Redis is unreachable. Fail CLOSED for live replays and OPEN for dry runs:
    // a dry run has no external side effect, so refusing it during a Redis
    // outage would be a pure availability loss, whereas an unmetered live
    // replay is precisely the abuse primitive this endpoint must not offer.
    if (!isDryRun) {
      logger.error(
        { userId: auth.user.id, automationId: automation.id, runId: run.id },
        'Refusing live automation replay: rate limiter unavailable'
      )
      return jsonError('Live replay is temporarily unavailable (rate limiter offline). Retry later.', 503)
    }

    logger.warn(
      { userId: auth.user.id, automationId: automation.id, runId: run.id },
      'Automation replay rate limiter unavailable; allowing dry-run replay'
    )
  }

  logger.info(
    { userId: auth.user.id, automationId: automation.id, runId: run.id, mode },
    'Replaying automation run'
  )

  const result = await replayAutomationRun(run.id, { isDryRun })
  return jsonSuccess({ ...result, mode, isDryRun }, 201)
}
