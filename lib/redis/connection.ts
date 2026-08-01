/**
 * Shared Redis connection options.
 *
 * Extracted from `lib/webhooks/queue.ts` so that consumers which are NOT BullMQ
 * — `lib/security/rate-limit.ts` — can reuse the same `REDIS_URL` parsing
 * without importing `bullmq`. The queue module pulls BullMQ in at module scope,
 * which is undesirable inside a request-path module and in jsdom test
 * environments.
 *
 * The only runtime dependencies are the standard `URL` parser and the config
 * layer; the `ioredis` import is type-only and is erased at compile time.
 */

import type { RedisOptions } from 'ioredis'
import { requireRedisUrl } from '@/lib/config'

/**
 * Builds ioredis connection options from `REDIS_URL`.
 *
 * The returned options are tuned for BullMQ (`maxRetriesPerRequest: null`,
 * `enableReadyCheck: false`). Non-BullMQ consumers should spread this and
 * override those two fields — an indefinitely-retrying command is exactly the
 * wrong behaviour on a latency-sensitive request path. `lib/security/rate-limit.ts`
 * does precisely that.
 *
 * The URL is already known to parse and to carry a host, so there is no
 * `hostname || '127.0.0.1'` fallback: a hostless URL is rejected at config read
 * rather than silently rewritten to loopback. An unset `REDIS_URL` throws —
 * reaching this function means a caller is about to connect, so there is
 * nothing sensible to fall back to.
 */
export function buildRedisOptions(): RedisOptions {
  const parsed = new URL(requireRedisUrl())
  return {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : 6379,
    // BullMQ blocking commands require this to be null; ioredis default is 20.
    maxRetriesPerRequest: null,
    // Skip the initial PING round-trip to improve startup latency.
    enableReadyCheck: false,
    // Reconnect with bounded exponential backoff (max 30s).
    retryStrategy: (times: number) => Math.min(Math.exp(times) * 1000, 30_000),
    // Enable TLS for rediss:// URLs (managed Redis services like AWS ElastiCache)
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    ...(parsed.username ? { username: parsed.username } : {}),
    ...(parsed.password ? { password: parsed.password } : {}),
    ...(parsed.pathname && parsed.pathname !== '/'
      ? { db: parseInt(parsed.pathname.slice(1), 10) }
      : {}),
  }
}
