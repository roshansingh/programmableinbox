/**
 * Redis-backed rate limiting and account lockout for authentication endpoints.
 *
 * ---------------------------------------------------------------------------
 * Algorithm — sliding window counter
 * ---------------------------------------------------------------------------
 * A fixed window (`INCR` on a key that expires every N seconds) is trivially
 * gamed: an attacker can send `limit` requests in the last millisecond of one
 * window and `limit` more in the first millisecond of the next, yielding 2x the
 * intended rate. We therefore use the *sliding window counter* approximation:
 *
 *   estimate = previousWindowCount * (1 - elapsedInCurrentWindow / windowMs)
 *            + currentWindowCount
 *
 * The previous window's contribution decays linearly as the current window
 * advances, so the effective rate is smooth across boundaries. Compared with a
 * sliding window *log* (a ZSET of timestamps) it uses O(1) memory per key
 * instead of O(limit), which matters because keys here are attacker-controlled
 * (one per source IP, one per submitted email address).
 *
 * Atomicity: the counter is incremented *unconditionally* before the decision
 * is made, inside a single `MULTI`/`EXEC` round trip:
 *
 *   MULTI; INCR current; PEXPIRE current; GET previous; EXEC
 *
 * There is no read-modify-write, so concurrent requests cannot race past the
 * limit — each one gets a distinct `INCR` result. Rejected requests also count,
 * which means a client that keeps hammering while blocked pushes its own reset
 * time further out.
 *
 * ---------------------------------------------------------------------------
 * Three distinct "no answer from Redis" states
 * ---------------------------------------------------------------------------
 * These are deliberately not collapsed into one, because the right response
 * differs for each:
 *
 *   1. DISABLED — `AUTH_RATE_LIMIT_ENABLED=false`. An explicit operator choice.
 *      No client is created, no command is issued, nothing is logged per
 *      request. Every decision is "allowed", and `degraded` is false because
 *      nothing is degraded: the feature is off on purpose.
 *
 *   2. UNCONFIGURED — rate limiting on but `REDIS_URL` unset. This never
 *      reaches runtime: `assertConfig()` refuses to boot (see
 *      `lib/config/assert.ts`). It is a deployment error, and a limiter that
 *      answered "allowed" to every request while emitting one log line a minute
 *      is precisely the failure that is easy to miss for months.
 *
 *   3. UNREACHABLE — configured, but down or too slow right now. Bounded by
 *      `RATE_LIMIT_TIMEOUT_MS` with `enableOfflineQueue: false`, so an outage
 *      surfaces as an immediate rejection rather than a hung login. What we do
 *      with it is `RATE_LIMIT_FAIL_MODE`:
 *        - `open` (default): allow, mark `degraded`, log at ERROR (throttled).
 *          Brute force is possible for the outage's duration — bounded,
 *          detectable, still throttled by bcrypt's cost factor.
 *        - `closed`: reject with 429. A Redis outage then becomes a full
 *          authentication outage, including for the operators who need to log
 *          in to fix it.
 *      We default to `open` because login availability is the higher-order
 *      concern; operators who prefer the opposite trade flip one variable.
 *
 * ---------------------------------------------------------------------------
 * What this module does NOT decide
 * ---------------------------------------------------------------------------
 * Whether a throttled *account* is refused is the caller's decision, not this
 * module's. `consumeRateLimit` and `getLockoutState` report; the login route
 * still verifies the password and admits a correct one. See the ordering
 * comment in `app/api/app/auth/login/route.ts` for why.
 */

import { createHash } from 'crypto'
import type { Redis } from 'ioredis'
import { config } from '@/lib/config'
import logger from '@/lib/logger'
import { buildRedisOptions } from '@/lib/redis/connection'

export type RateLimitConfig = (typeof config)['rateLimit']

/** Reads the memoized `rateLimit` config domain. */
export function getRateLimitConfig(): RateLimitConfig {
  return config.rateLimit
}

export interface RateLimitPolicy {
  /** Maximum number of requests allowed within `windowMs`. */
  limit: number
  /** Length of the sliding window, in milliseconds. */
  windowMs: number
}

// ---------------------------------------------------------------------------
// Redis client
// ---------------------------------------------------------------------------

/**
 * The subset of the ioredis surface the limiter needs.
 *
 * Keeping it this narrow lets tests inject a deterministic in-memory fake that
 * exercises the *real* limiter logic rather than a re-implementation of it.
 */
export interface RateLimitRedis {
  multi(commands: unknown[][]): { exec(): Promise<Array<[Error | null, unknown]> | null> }
  pttl(key: string): Promise<number>
  /** Used to repair a lock key found without a TTL — see `getLockoutState`. */
  pexpire(key: string, ms: number): Promise<number>
  set(key: string, value: string, mode: 'PX', ttl: number): Promise<unknown>
  del(...keys: string[]): Promise<number>
}

let _client: RateLimitRedis | null = null
let _clientPromise: Promise<RateLimitRedis | null> | null = null
/**
 * True when `_client` is a real ioredis connection this module opened, as
 * opposed to a fake injected by a test. Only the former owns a socket that has
 * to be closed.
 */
let _ownsClient = false

/**
 * Injects a client (used by tests, and available for custom wiring).
 * Passing `null` clears the cached client so the next call reconnects.
 *
 * A real connection is closed rather than dropped on the floor. Leaking it left
 * an ioredis reconnect loop running for the rest of the process, which in a
 * watch-mode test run accumulates one timer per reset.
 */
export function setRateLimitRedisClient(client: RateLimitRedis | null): void {
  if (_ownsClient && _client && _client !== client) {
    void (_client as unknown as Redis).quit?.().catch(() => {})
  }
  _client = client
  _clientPromise = null
  _ownsClient = false
}

/**
 * Resolves once the connection can carry commands, or when the budget elapses.
 *
 * `enableOfflineQueue: false` is what turns an outage into an immediate
 * rejection rather than a hang, but it applies just as ruthlessly to a socket
 * that is merely still opening: `new Redis()` returns in state `connecting`,
 * and any command issued before `ready` rejects with *"Stream isn't writeable
 * and enableOfflineQueue options is false"*. Without this wait the first
 * request of every process — the first login after each deploy — skips the
 * limiter and logs an outage, against a perfectly healthy Redis.
 *
 * It never rejects and never waits longer than the limiter's own per-request
 * budget, and a first connection that fails outright resolves it early rather
 * than burning the budget: an unreachable Redis costs no more latency than it
 * does today. A connection that is not ready in time is still returned —
 * ioredis keeps retrying underneath, so the command fails fast, the fail mode
 * decides, and the next request finds a ready client instead of waiting again.
 */
function waitForReady(client: Redis, timeoutMs: number): Promise<void> {
  if (client.status === 'ready') return Promise.resolve()

  return new Promise<void>((resolve) => {
    const settle = () => {
      clearTimeout(timer)
      client.removeListener('ready', settle)
      client.removeListener('error', settle)
      resolve()
    }
    const timer = setTimeout(settle, timeoutMs)
    // A pending connect must not be the reason a short-lived process lingers.
    timer.unref?.()
    client.once('ready', settle)
    client.once('error', settle)
  })
}

/**
 * Lazily creates a Redis connection dedicated to rate limiting.
 *
 * A *separate* connection from `lib/webhooks/queue.ts` is intentional: the
 * BullMQ client is configured with `maxRetriesPerRequest: null` and the default
 * offline queue, so commands issued while Redis is down are buffered forever.
 * On a login request that is a hang, not a failure. This client fails fast
 * instead, and it also keeps limiter latency off the queue's connection.
 *
 * `ioredis` is imported dynamically so that importing this module (e.g. from a
 * jsdom route test) does not pull a TCP client into the module graph.
 *
 * The connection is awaited to `ready` before it is cached and returned — see
 * `waitForReady` for why that is not something ioredis does for us here.
 */
async function getClient(): Promise<RateLimitRedis | null> {
  if (_client) return _client
  if (_clientPromise) return _clientPromise

  _clientPromise = (async () => {
    try {
      // Destructure `default`, not `Redis`: ioredis's CJS entry reassigns
      // `module.exports` to a function, which strips the `__esModule` flag.
      // Webpack's dynamic-import namespace helper only copies named exports
      // when the resolved value's `typeof` is `'object'` — a function fails
      // that check, so `Redis` comes back `undefined` while `default` (set
      // unconditionally) does not. Destructuring `Redis` here is what
      // produced prod's "a is not a constructor" (new undefined()).
      const { default: RedisCtor } = await import('ioredis')
      const { timeoutMs } = getRateLimitConfig()
      const client: Redis = new RedisCtor({
        ...buildRedisOptions(),
        // Fail fast rather than retry forever — this is a request-path client.
        maxRetriesPerRequest: 1,
        // Reject immediately instead of buffering commands while disconnected.
        enableOfflineQueue: false,
        connectTimeout: Math.max(timeoutMs, 1000),
        commandTimeout: timeoutMs,
        retryStrategy: (times: number) => Math.min(times * 200, 5_000),
      })
      // ioredis emits 'error' on every failed reconnect; without a listener
      // Node treats it as an unhandled error event and crashes the process.
      client.on('error', (error: Error) => {
        logger.debug({ error }, 'Rate limit Redis connection error')
      })
      await waitForReady(client, timeoutMs)
      _client = client as unknown as RateLimitRedis
      _ownsClient = true
      return _client
    } catch (error) {
      // Reaching here means REDIS_URL is unset or unparseable despite
      // assertConfig() — a boot that skipped the assertion, or a mid-process
      // mutation in a test. Log loudly; the fail mode decides the rest.
      logger.error({ error }, 'Failed to create rate limit Redis client')
      _clientPromise = null
      return null
    }
  })()

  return _clientPromise
}

/**
 * True when any reply in a MULTI/EXEC result carries an error.
 *
 * ioredis returns `[error, value]` per queued command. Inspecting only the first
 * reply lets a failed PEXPIRE or GET through, and both fail in the permissive
 * direction (no TTL, or a zeroed previous window).
 */
function hasReplyError(replies: Array<[Error | null, unknown]> | null): boolean {
  return !replies || replies.some((reply) => !reply || reply[0])
}

/**
 * Rate-limits a repeating log line.
 *
 * Redis being down means *every* request takes the failure path, so logging per
 * request turns an outage into a log storm — extra load and cost at exactly the
 * moment the system is already degraded, and it buries the signal. One line
 * when the condition starts, then at most one per interval carrying the
 * suppressed count.
 */
const LOG_THROTTLE_INTERVAL_MS = 60_000

class ThrottledLog {
  private lastAt = 0
  private suppressed = 0

  constructor(
    private readonly emit: (payload: Record<string, unknown>, suppressed: number) => void,
  ) {}

  record(payload: Record<string, unknown>, now: number = Date.now()): void {
    if (now - this.lastAt >= LOG_THROTTLE_INTERVAL_MS) {
      this.emit(payload, this.suppressed)
      this.lastAt = now
      this.suppressed = 0
    } else {
      this.suppressed++
    }
  }

  reset(): void {
    this.lastAt = 0
    this.suppressed = 0
  }
}

const outageLog = new ThrottledLog((payload, suppressed) =>
  logger.error({ ...payload, suppressed }, 'Rate limit backend unavailable'),
)

const untrustedIpLog = new ThrottledLog((payload, suppressed) =>
  logger.warn(
    { ...payload, suppressed },
    'Cannot derive a trustworthy client IP — per-IP rate limiting is inactive',
  ),
)

/**
 * When the request path last failed to reach Redis. Feeds the health endpoint.
 * Null until an outage happens.
 */
let _lastOutageAt: number | null = null

/** How long after a failure the backend is still reported as degraded. */
const OUTAGE_STALE_AFTER_MS = 60_000

/** Test seam: forget throttle and outage state between tests. */
export function __resetLogThrottlesForTests(): void {
  outageLog.reset()
  untrustedIpLog.reset()
  _lastOutageAt = null
}

export interface RateLimitBackendStatus {
  /** Whether the operator has the limiter switched on at all. */
  enabled: boolean
  state: 'ok' | 'degraded' | 'disabled'
  /** Milliseconds since the last failed Redis call; null if there has been none. */
  lastOutageAgoMs: number | null
  /** What a failed call does — useful when reading a degraded report. */
  failMode: 'open' | 'closed'
}

/**
 * Reports the limiter's backend health for `/api/healthz`.
 *
 * Deliberately *passive*: it reflects what real requests have experienced
 * rather than issuing a probe, so polling the health endpoint costs no Redis
 * round trip and cannot itself be the thing that keeps a struggling Redis busy.
 * The flip side is that a limiter nothing has called yet reports `ok`, which is
 * the honest answer — nothing has failed.
 *
 * Note that a degraded limiter does NOT make the overall health check fail.
 * Fail-open means the app is still serving logins; returning 503 would pull a
 * working instance out of its load balancer over a non-fatal dependency.
 */
export function rateLimitBackendStatus(now: number = Date.now()): RateLimitBackendStatus {
  const { enabled, failMode } = getRateLimitConfig()
  const lastOutageAgoMs = _lastOutageAt === null ? null : now - _lastOutageAt
  const degraded = lastOutageAgoMs !== null && lastOutageAgoMs < OUTAGE_STALE_AFTER_MS

  return {
    enabled,
    state: !enabled ? 'disabled' : degraded ? 'degraded' : 'ok',
    lastOutageAgoMs,
    failMode,
  }
}

/**
 * Runs a Redis operation with a hard timeout.
 * Returns `null` if the backend is unreachable, errored, or too slow.
 */
async function withRedis<T>(op: (client: RateLimitRedis) => Promise<T>): Promise<T | null> {
  const { timeoutMs } = getRateLimitConfig()
  const client = await getClient()
  if (!client) return null

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      op(client),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('rate limit redis timeout')), timeoutMs)
      }),
    ])
  } catch (error) {
    _lastOutageAt = Date.now()
    outageLog.record({ error })
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

const KEY_PREFIX = 'rl'

/**
 * Normalises an email into an opaque, fixed-length bucket identifier.
 *
 * Hashing keeps raw addresses (PII) out of Redis keys and bounds key length
 * regardless of what an attacker submits. It is *not* a secret — it only needs
 * to be collision-resistant and stable.
 */
export function accountBucket(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32)
}

/**
 * Normalises a client address into a rate-limit bucket.
 *
 * IPv6 addresses are bucketed by their /64 prefix: end users are routinely
 * handed an entire /64, so limiting a single /128 would be free to evade.
 */
export function ipBucket(rawIp: string): string {
  let ip = rawIp.trim().toLowerCase()
  if (!ip) return 'unknown'

  // Bracketed IPv6, with or without a port: "[::1]" / "[2001:db8::1]:8443".
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/)
  if (bracketed) ip = bracketed[1]

  // IPv4, with or without a port that leaked through ("1.2.3.4:5678").
  const ipv4 = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/)
  if (ipv4) return ipv4[1]

  if (ip.includes(':')) {
    const prefix = ipv6Prefix64(ip)
    // Fall back to the raw address only when it could not be parsed at all.
    // Bucketing per-/128 there is the safe direction: it over-counts distinct
    // clients rather than letting one client masquerade as many.
    return prefix ?? ip
  }
  return ip
}

/**
 * Expands an IPv6 address and returns its /64 bucket key, or null if unparseable.
 *
 * The `::` form must be expanded before slicing. Skipping compressed addresses
 * and bucketing them per-/128 defeated the whole control: `2001:db8:1:2::1` and
 * `2001:db8:1:2::2` are one /64 that an attacker is typically handed in full, so
 * varying the interface identifier bought an unlimited number of buckets. Nearly
 * every real-world address is written compressed, so that was the common case,
 * not the edge case.
 */
function ipv6Prefix64(raw: string): string | null {
  let addr = raw
  // An embedded IPv4 tail ("::ffff:1.2.3.4") occupies the last two hextets.
  const v4Tail = addr.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (v4Tail) {
    const octets = v4Tail[1].split('.').map(Number)
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null
    const hi = ((octets[0] << 8) | octets[1]).toString(16)
    const lo = ((octets[2] << 8) | octets[3]).toString(16)
    addr = `${addr.slice(0, v4Tail.index)}${hi}:${lo}`
  }

  const halves = addr.split('::')
  if (halves.length > 2) return null

  const split = (part: string) => (part ? part.split(':') : [])
  const head = split(halves[0])
  const tail = halves.length === 2 ? split(halves[1]) : []

  let hextets: string[]
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length
    if (missing < 1) return null
    hextets = [...head, ...Array(missing).fill('0'), ...tail]
  } else {
    hextets = head
  }

  if (hextets.length !== 8) return null
  if (!hextets.every((h) => /^[0-9a-f]{1,4}$/.test(h))) return null

  // Strip leading zeros so 2001:0db8:... and 2001:db8:... share a bucket.
  const canonical = hextets.slice(0, 4).map((h) => h.replace(/^0+(?=.)/, ''))
  return `${canonical.join(':')}::/64`
}

/** Why a request has no trustworthy client IP. Null when it has one. */
export type UntrustedIpReason = 'no-trusted-proxy' | 'missing-header' | 'chain-too-short'

export interface ClientIpResult {
  /**
   * The bucket key to rate limit on, or `null` when no trustworthy address
   * could be derived. Null means "do not apply per-IP limiting", NOT "bucket
   * everyone together" — see below.
   */
  ip: string | null
  reason: UntrustedIpReason | null
}

/**
 * Derives the client IP from `X-Forwarded-For`.
 *
 * TRUST MODEL — this is the security-critical part.
 *
 * `X-Forwarded-For` is client-controlled and therefore worthless unless a
 * trusted proxy appends to it. In this deployment Caddy is the only public
 * ingress (`deploy/docker-compose.yml` publishes ports on the `caddy` service
 * only; `app` is reachable solely over the internal Docker network) and Caddy's
 * `reverse_proxy` *appends* the TCP peer address to any inbound XFF. So the
 * chain the app sees is:
 *
 *     [ ...anything the client forged... , <real client IP observed by Caddy> ]
 *
 * We therefore take the entry at `length - TRUSTED_PROXY_COUNT` (rightmost by
 * default), never `split(',')[0]`. Taking the leftmost element would let any
 * attacker send `X-Forwarded-For: <random>` and get a fresh per-IP budget on
 * every request, defeating the per-IP limit entirely.
 *
 * WHEN NO ADDRESS CAN BE TRUSTED we return `null` and the caller skips per-IP
 * limiting, logging a throttled warning. An earlier revision bucketed these
 * requests together under the literal key `unknown`, reasoning that
 * over-limiting is the safe direction. It is not, for this endpoint: a
 * deployment whose proxy does not set the header — or a developer running
 * `npm run dev` — would put every user on Earth into a single 20-per-5-minutes
 * login budget, which is a self-inflicted authentication outage rather than a
 * conservative default. Per-account limiting and lockout are unaffected and
 * still bound online guessing; per-IP is the anti-spray control specifically,
 * and it cannot function without a trustworthy address.
 *
 * `TRUSTED_PROXY_COUNT=0` states outright that nothing trustworthy sits in
 * front, and short-circuits to the same result. A proxy that sets only
 * `X-Real-IP` is not supported: if `X-Forwarded-For` is absent there is no
 * evidence a trusted proxy was involved at all, so `X-Real-IP` would be just as
 * forgeable as the leftmost XFF entry.
 */
export function getClientIp(request: { headers: Headers }): ClientIpResult {
  const { trustedProxyCount } = getRateLimitConfig()
  if (trustedProxyCount === 0) return { ip: null, reason: 'no-trusted-proxy' }

  const chain = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (chain.length === 0) return { ip: null, reason: 'missing-header' }

  const index = chain.length - trustedProxyCount
  // Fewer entries than declared proxies: the deployment is not shaped the way
  // TRUSTED_PROXY_COUNT claims, so nothing in the chain is known to be appended
  // by a trusted hop.
  if (index < 0) return { ip: null, reason: 'chain-too-short' }

  return { ip: ipBucket(chain[index]), reason: null }
}

// ---------------------------------------------------------------------------
// Sliding window counter
// ---------------------------------------------------------------------------

export interface RateLimitDecision {
  allowed: boolean
  /** Configured ceiling for the policy that produced this decision. */
  limit: number
  /** Requests still available in the window (never negative). */
  remaining: number
  /** Seconds until the caller may retry — suitable for `Retry-After`. */
  retryAfterSeconds: number
  /** Seconds until the window frees up — suitable for `RateLimit-Reset`. */
  resetSeconds: number
  /**
   * True only when a working backend was expected and did not answer. False
   * when the limiter is switched off, which is not a degradation.
   */
  degraded: boolean
  /** Which limiter produced the decision (for logs and debugging). */
  scope: string
}

/**
 * Time until one more request would fit, assuming the caller stops sending.
 *
 * `prev`/`curr` are the two window counters and `elapsed` is the offset into
 * the current window. The estimate decays linearly, so this inverts that decay
 * rather than blindly returning "the rest of the window" (which under-promises
 * whenever the current window alone is already over the limit).
 */
export function retryAfterMsFor(
  prev: number,
  curr: number,
  limit: number,
  windowMs: number,
  elapsed: number,
): number {
  // A future request is admitted when the estimate *before* it is <= limit - 1.
  const target = limit - 1

  if (curr <= target) {
    if (prev <= 0) return 0
    // Solve prev * (1 - e / windowMs) <= target - curr for e.
    const allowance = target - curr
    const e = windowMs * (1 - allowance / prev)
    if (e <= elapsed) return 0
    if (e <= windowMs) return Math.ceil(e - elapsed)
    return Math.ceil(windowMs - elapsed)
  }

  // The current window alone is already over budget: wait for it to roll into
  // the "previous" slot and then decay far enough.
  const remainderOfCurrent = windowMs - elapsed
  const e2 = windowMs * (1 - target / curr)
  return Math.ceil(remainderOfCurrent + Math.max(e2, 0))
}

/**
 * Consumes one unit from a sliding window counter.
 *
 * Note the ordering: the counter is incremented before the decision, so a
 * rejected attempt still contributes. See the module docblock.
 */
export async function consumeRateLimit(
  scope: string,
  key: string,
  policy: RateLimitPolicy,
  now: number = Date.now(),
): Promise<RateLimitDecision> {
  if (!getRateLimitConfig().enabled) return disabledDecision(scope, policy)

  const { windowMs, limit } = policy
  const windowIndex = Math.floor(now / windowMs)
  const elapsed = now - windowIndex * windowMs
  const currentKey = `${KEY_PREFIX}:${scope}:${key}:${windowIndex}`
  const previousKey = `${KEY_PREFIX}:${scope}:${key}:${windowIndex - 1}`

  const result = await withRedis(async (client) =>
    client
      .multi([
        ['incr', currentKey],
        // Two windows of TTL so the counter survives long enough to act as the
        // "previous" window for the whole of the next one.
        ['pexpire', currentKey, windowMs * 2],
        ['get', previousKey],
      ])
      .exec(),
  )

  // A queued command can fail individually inside MULTI (e.g. WRONGTYPE); treat
  // that the same as an unreachable backend rather than reading garbage.
  //
  // Every reply is checked, not just the INCR. A failed GET would leave `prev`
  // at 0 and a failed PEXPIRE would leave the counter without a TTL — both make
  // the limiter under-count and let extra requests through, which is precisely
  // the direction that must not fail silently.
  if (!result || hasReplyError(result)) {
    return unavailableDecision(scope, policy)
  }

  const curr = Number(result[0]?.[1] ?? 0)
  const prev = Number(result[2]?.[1] ?? 0) || 0
  const weight = 1 - elapsed / windowMs
  const estimate = prev * weight + curr
  const allowed = estimate <= limit

  return {
    allowed,
    limit,
    remaining: Math.max(0, Math.floor(limit - estimate)),
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil(retryAfterMsFor(prev, curr, limit, windowMs, elapsed) / 1000)),
    resetSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
    degraded: false,
    scope,
  }
}

/**
 * Applies a per-IP policy when — and only when — a trustworthy client address
 * is available.
 *
 * Returns `null` when there is none, meaning "no per-IP decision was made".
 * Callers must treat that as "carry on", not as a rejection: see `getClientIp`
 * for why the alternative (one shared bucket) is worse than no bucket.
 */
export async function consumeClientIpRateLimit(
  scope: string,
  client: ClientIpResult,
  policy: RateLimitPolicy,
  now: number = Date.now(),
): Promise<RateLimitDecision | null> {
  if (client.ip === null) {
    if (getRateLimitConfig().enabled) untrustedIpLog.record({ scope, reason: client.reason })
    return null
  }
  return consumeRateLimit(scope, client.ip, policy, now)
}

/** The decision returned when Redis could not be reached, per `failMode`. */
function unavailableDecision(scope: string, policy: RateLimitPolicy): RateLimitDecision {
  const open = getRateLimitConfig().failMode === 'open'
  return {
    allowed: open,
    limit: policy.limit,
    remaining: open ? policy.limit : 0,
    retryAfterSeconds: open ? 0 : Math.ceil(policy.windowMs / 1000),
    resetSeconds: Math.ceil(policy.windowMs / 1000),
    degraded: true,
    scope,
  }
}

/** The decision returned when the limiter is switched off by configuration. */
function disabledDecision(scope: string, policy: RateLimitPolicy): RateLimitDecision {
  return {
    allowed: true,
    limit: policy.limit,
    remaining: policy.limit,
    retryAfterSeconds: 0,
    resetSeconds: Math.ceil(policy.windowMs / 1000),
    degraded: false,
    scope,
  }
}

// ---------------------------------------------------------------------------
// Progressive lockout
// ---------------------------------------------------------------------------

export interface LockoutState {
  locked: boolean
  retryAfterSeconds: number
  degraded: boolean
}

const UNLOCKED: LockoutState = { locked: false, retryAfterSeconds: 0, degraded: false }

function failureKey(scope: string, bucket: string): string {
  return `${KEY_PREFIX}:${scope}:fail:${bucket}`
}

function lockKey(scope: string, bucket: string): string {
  return `${KEY_PREFIX}:${scope}:lock:${bucket}`
}

/**
 * Lockout duration for the Nth consecutive failure: doubles from
 * `lockoutBaseMs` starting at the threshold, capped at `lockoutMaxMs`.
 * Returns 0 below the threshold.
 *
 * The cap is deliberately modest (15 min by default) because per-account
 * lockout is itself a denial-of-service primitive — anyone who knows an address
 * can trigger it. A short, decaying lockout defeats online guessing without
 * handing an attacker an indefinite account freeze. The login route narrows the
 * window further by admitting a correct password regardless of lock state.
 */
export function lockoutDurationMs(
  failures: number,
  cfg: Pick<RateLimitConfig, 'lockout'> = getRateLimitConfig(),
): number {
  const { threshold, baseMs, maxMs } = cfg.lockout
  if (failures < threshold) return 0
  return Math.min(baseMs * Math.pow(2, failures - threshold), maxMs)
}

/**
 * Returns the current lockout state for an account bucket.
 *
 * Callers MUST invoke this for every submitted address, whether or not an
 * account exists, otherwise the lockout itself becomes an enumeration oracle.
 */
export async function getLockoutState(scope: string, bucket: string): Promise<LockoutState> {
  if (!getRateLimitConfig().enabled) return UNLOCKED

  const ttl = await withRedis(async (client) => client.pttl(lockKey(scope, bucket)))

  if (ttl === null) {
    // Fail-closed treats an unreachable backend as "locked"; fail-open does not.
    const locked = getRateLimitConfig().failMode === 'closed'
    return { locked, retryAfterSeconds: 60, degraded: true }
  }

  // ioredis PTTL: -2 = no key (genuinely not locked), -1 = key EXISTS but has no
  // expiry. Collapsing those two into "unlocked" meant a lock key that ever lost
  // its TTL silently disabled lockout for that bucket forever. A lock key must
  // always expire, so treat -1 as locked and repair the TTL rather than ignoring
  // a key that is present.
  if (ttl === -2) return UNLOCKED

  if (ttl === -1) {
    const { baseMs } = getRateLimitConfig().lockout
    await withRedis(async (client) => client.pexpire(lockKey(scope, bucket), baseMs))
    logger.warn({ scope, bucket }, 'Lockout key had no TTL; treating as locked and restoring expiry')
    return {
      locked: true,
      retryAfterSeconds: Math.max(1, Math.ceil(baseMs / 1000)),
      degraded: false,
    }
  }

  if (ttl <= 0) return UNLOCKED
  return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)), degraded: false }
}

/**
 * Records one failed authentication attempt and applies progressive lockout.
 * Returns the new consecutive-failure count and the lockout applied (0 if none).
 */
export async function recordFailure(
  scope: string,
  bucket: string,
): Promise<{ failures: number; lockedForSeconds: number }> {
  const cfg = getRateLimitConfig()
  if (!cfg.enabled) return { failures: 0, lockedForSeconds: 0 }

  const key = failureKey(scope, bucket)

  const result = await withRedis(async (client) =>
    client
      .multi([
        ['incr', key],
        ['pexpire', key, cfg.lockout.failureWindowMs],
      ])
      .exec(),
  )

  // Check every reply, not just the INCR: a failed PEXPIRE leaves the failure
  // counter without a TTL, so it never decays and the account stays effectively
  // locked out forever.
  if (!result || hasReplyError(result)) return { failures: 0, lockedForSeconds: 0 }

  const failures = Number(result[0]?.[1] ?? 0)
  const lockMs = lockoutDurationMs(failures, cfg)
  if (lockMs <= 0) return { failures, lockedForSeconds: 0 }

  await withRedis(async (client) => client.set(lockKey(scope, bucket), String(failures), 'PX', lockMs))
  return { failures, lockedForSeconds: Math.ceil(lockMs / 1000) }
}

/**
 * Clears the consecutive-failure counter and any active lockout.
 * Called after a successful authentication.
 */
export async function clearFailures(scope: string, bucket: string): Promise<void> {
  if (!getRateLimitConfig().enabled) return
  await withRedis(async (client) => client.del(failureKey(scope, bucket), lockKey(scope, bucket)))
}

// ---------------------------------------------------------------------------
// HTTP glue
// ---------------------------------------------------------------------------

/**
 * Standard rate-limit response headers.
 *
 * Follows draft-ietf-httpapi-ratelimit-headers naming (`RateLimit-*`, values in
 * seconds) plus the long-established `Retry-After`.
 */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    'Retry-After': String(Math.max(1, decision.retryAfterSeconds || decision.resetSeconds)),
    'RateLimit-Limit': String(decision.limit),
    'RateLimit-Remaining': String(decision.remaining),
    'RateLimit-Reset': String(decision.resetSeconds),
  }
}

/** Headers for a lockout rejection, shaped identically to a rate-limit one. */
export function lockoutHeaders(state: LockoutState, limit: number): Record<string, string> {
  return {
    'Retry-After': String(Math.max(1, state.retryAfterSeconds)),
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': '0',
    'RateLimit-Reset': String(Math.max(1, state.retryAfterSeconds)),
  }
}
