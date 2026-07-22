/**
 * Rate limiter for automation run replay (security issue #40).
 *
 * Replay re-executes a stored run. A *live* replay performs the run's real
 * side effects again — `send_webhook` does an outbound `fetch`, `forward_email`
 * and `auto_reply` send real mail — so an authenticated tenant that can loop
 * the endpoint gets an on-demand, arbitrarily repeatable outbound-request /
 * outbound-mail primitive. This module bounds that.
 *
 * Deliberately narrow and self-contained: it only knows about the replay
 * endpoint. A general-purpose limiter (shared with auth throttling, issue #42)
 * should later absorb this — see the TODO at the bottom.
 *
 * Algorithm: fixed window counters in Redis. The key embeds the window index,
 * so a new window is a new key and expiry is self-cleaning. Fixed windows allow
 * up to 2x the limit across a window boundary; that is an accepted trade for an
 * abuse ceiling, as opposed to a billing meter.
 *
 * Cost: `INCR` + `EXPIRE` per counter, and two counters (user and automation)
 * are always checked, so a request issues four sequential Redis commands. They
 * are deliberately NOT pipelined: `ReplayRateLimitClient` below is a two-method
 * surface so tests can inject a plain object and never open a socket, and
 * `multi()`/`pipeline()` would drag the whole ioredis chainable API into that
 * seam. Four round trips against a local Redis is not the bottleneck on an
 * endpoint whose purpose is to re-execute an automation. When the general
 * limiter from issue #42 absorbs this module (see the TODO at the bottom), it
 * should collapse these into a single `MULTI` — that limiter already does.
 */

import { Redis } from 'ioredis'
import logger from '@/lib/logger'

export type ReplayMode = 'dry_run' | 'live'
export type ReplayRateLimitScope = 'user' | 'automation'

export type ReplayRateLimitBudget = { limit: number; windowSeconds: number }

/**
 * Per-mode budgets. Dry-run and live have independent buckets so a burst of
 * (harmless) dry replays can never eat the live budget, and vice versa.
 *
 * Live is deliberately tight: a legitimate operator re-running one production
 * run to debug it needs single-digit attempts per minute, not hundreds.
 */
export const REPLAY_RATE_LIMITS: Record<ReplayMode, Record<ReplayRateLimitScope, ReplayRateLimitBudget>> = {
  dry_run: {
    user: { limit: 30, windowSeconds: 60 },
    automation: { limit: 60, windowSeconds: 60 },
  },
  live: {
    user: { limit: 5, windowSeconds: 60 },
    automation: { limit: 10, windowSeconds: 60 },
  },
}

/** Hard cap on how long a limiter Redis round trip may block a request. */
export const REPLAY_RATE_LIMIT_TIMEOUT_MS = 1_000

export type ReplayRateLimitDecision =
  | { allowed: true }
  | {
      allowed: false
      reason: 'limit_exceeded'
      scope: ReplayRateLimitScope
      limit: number
      windowSeconds: number
      retryAfterSeconds: number
    }
  | { allowed: false; reason: 'unavailable' }

/**
 * Minimal client surface the limiter needs. Satisfied by ioredis and by test
 * doubles alike, so tests never open a socket.
 */
export type ReplayRateLimitClient = {
  incr: (key: string) => Promise<number>
  expire: (key: string, seconds: number) => Promise<unknown>
}

let _client: ReplayRateLimitClient | null = null

/**
 * Dedicated ioredis connection for the limiter, created on first use.
 *
 * Deliberately NOT the BullMQ queue client from `lib/webhooks/queue`: that one
 * is configured with `maxRetriesPerRequest: null`, which makes commands wait
 * indefinitely while Redis is down. A limiter that hangs turns a Redis outage
 * into an app outage, so this connection fails fast instead. Keeping the
 * connection local also keeps this module free of the BullMQ import.
 */
function getLimiterRedis(): ReplayRateLimitClient {
  if (!_client) {
    const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      connectTimeout: REPLAY_RATE_LIMIT_TIMEOUT_MS,
      commandTimeout: REPLAY_RATE_LIMIT_TIMEOUT_MS,
      // Bounded backoff; `null` would stop reconnecting after the first failure.
      retryStrategy: (times: number) => Math.min(times * 500, 10_000),
    })
    // Without a listener, ioredis connection errors are emitted as unhandled
    // 'error' events and crash the process.
    client.on('error', (error: unknown) => {
      logger.warn({ error }, 'Automation replay rate limiter Redis error')
    })
    _client = client
  }
  return _client
}

/** Test seam: inject a fake client (or `null` to restore the real one). */
export function setReplayRateLimitClient(client: ReplayRateLimitClient | null): void {
  _client = client
}

function buildKey(
  mode: ReplayMode,
  scope: ReplayRateLimitScope,
  id: string,
  windowSeconds: number,
  now: number
): string {
  const windowIndex = Math.floor(now / (windowSeconds * 1000))
  return `ratelimit:automation-replay:${mode}:${scope}:${id}:${windowIndex}`
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('replay rate limiter timed out')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Consumes one unit from the per-user and per-automation budgets for `mode`.
 *
 * Both counters are always incremented, even when the first one already denies
 * the request: a caller hammering the endpoint should not get free attempts on
 * the other scope. Returns `{ allowed: false, reason: 'unavailable' }` when
 * Redis cannot be reached — the caller decides fail-open vs fail-closed, since
 * that choice depends on whether the replay has real side effects.
 */
export async function consumeReplayRateLimit(params: {
  userId: string
  automationId: string
  mode: ReplayMode
  now?: number
}): Promise<ReplayRateLimitDecision> {
  const now = params.now ?? Date.now()
  const budgets = REPLAY_RATE_LIMITS[params.mode]
  const targets: Array<{ scope: ReplayRateLimitScope; id: string; budget: ReplayRateLimitBudget }> = [
    { scope: 'user', id: params.userId, budget: budgets.user },
    { scope: 'automation', id: params.automationId, budget: budgets.automation },
  ]

  let client: ReplayRateLimitClient
  try {
    client = getLimiterRedis()
  } catch (error) {
    logger.warn({ error }, 'Automation replay rate limiter unavailable (client init failed)')
    return { allowed: false, reason: 'unavailable' }
  }

  let denial: ReplayRateLimitDecision | null = null

  for (const target of targets) {
    const key = buildKey(params.mode, target.scope, target.id, target.budget.windowSeconds, now)
    let count: number
    try {
      count = await withTimeout(Promise.resolve(client.incr(key)), REPLAY_RATE_LIMIT_TIMEOUT_MS)
      // Set the TTL on every hit rather than only on the first: an `incr` that
      // lands on a key whose `expire` previously failed would otherwise leak a
      // permanent counter and lock the tenant out forever.
      await withTimeout(
        Promise.resolve(client.expire(key, target.budget.windowSeconds)),
        REPLAY_RATE_LIMIT_TIMEOUT_MS
      )
    } catch (error) {
      logger.warn(
        { error, scope: target.scope, mode: params.mode },
        'Automation replay rate limiter unavailable (Redis command failed)'
      )
      return { allowed: false, reason: 'unavailable' }
    }

    if (count > target.budget.limit && !denial) {
      const windowMs = target.budget.windowSeconds * 1000
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000))
      denial = {
        allowed: false,
        reason: 'limit_exceeded',
        scope: target.scope,
        limit: target.budget.limit,
        windowSeconds: target.budget.windowSeconds,
        retryAfterSeconds,
      }
    }
  }

  return denial ?? { allowed: true }
}

// TODO(#42): unify with the shared auth rate limiter once that lands; this
// module intentionally duplicates a small amount of fixed-window logic to avoid
// a merge collision between two concurrent security PRs.
