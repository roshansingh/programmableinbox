/**
 * BullMQ queue client for async email webhook processing.
 *
 * Uses ioredis (bundled with BullMQ) rather than the `redis` v4 client, which
 * is not compatible with BullMQ's blocking-command requirements. The `redis` v4
 * package in package.json is available for other uses (e.g. caching), but
 * BullMQ connections must go through ioredis.
 */

import { Queue } from "bullmq";
import { Redis, type RedisOptions } from "ioredis";
import { config } from "@/lib/config";

// ---------------------------------------------------------------------------
// Job type
// ---------------------------------------------------------------------------

/** Data stored with every queued email-webhook job. */
export interface EmailWebhookJobData {
  /** Resend's external email ID — used for idempotency. */
  externalId: string;
  /** Which inbox received this email — used for observability (job name) and idempotency. */
  inboxEmailAddressId: string;
  /** Full raw payload received from Resend. */
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const WEBHOOK_QUEUE_NAME = "email-webhook-jobs";

/**
 * Runtime configuration derived from the validated config module.
 * Values are lazily read on first access so that module evaluation at build
 * time does not trigger config validation.
 */
export const WEBHOOK_QUEUE_CONFIG = {
  /** Number of times a failed job is retried before being dead-lettered. */
  get maxRetries(): number { return config.webhookQueue.maxRetries; },
  /**
   * Maximum number of inboxes processed concurrently by the worker.
   * Each inbox is processed serially; this caps parallel inbox processing.
   */
  get concurrencyPerInbox(): number { return config.webhookQueue.concurrencyPerInbox; },
};

// ---------------------------------------------------------------------------
// Redis connection singleton
// ---------------------------------------------------------------------------

export function buildRedisOptions(): RedisOptions {
  const url = config.redis.url;

  // Parse the URL manually so we can inject ioredis-specific options that
  // BullMQ requires (maxRetriesPerRequest: null) while still accepting a URL.
  const parsed = new URL(url);
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port ? parseInt(parsed.port, 10) : 6379,
    // BullMQ blocking commands require this to be null; ioredis default is 20.
    maxRetriesPerRequest: null,
    // Skip the initial PING round-trip to improve startup latency.
    enableReadyCheck: false,
    // Reconnect with bounded exponential backoff (max 30s).
    retryStrategy: (times: number) =>
      Math.min(Math.exp(times) * 1000, 30_000),
    // Enable TLS for rediss:// URLs (managed Redis services like AWS ElastiCache)
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    ...(parsed.username ? { username: parsed.username } : {}),
    ...(parsed.password ? { password: parsed.password } : {}),
    ...(parsed.pathname && parsed.pathname !== "/"
      ? { db: parseInt(parsed.pathname.slice(1), 10) }
      : {}),
  };
}

/**
 * Shared ioredis client used by the Queue singleton.
 *
 * WARNING: Do NOT pass this instance to a BullMQ Worker. Workers run in
 * blocking mode and must have their own dedicated connection. Pass
 * connection options to the Worker instead, or create a separate client.
 */
let _redisClient: Redis | null = null;

/**
 * Returns the singleton ioredis client, creating it on first call.
 *
 * Use this for the Queue singleton only. Do NOT pass this to a BullMQ Worker —
 * see the WARNING on _redisClient above.
 */
export function getRedisClient(): Redis {
  if (!_redisClient) {
    _redisClient = new Redis(buildRedisOptions());
  }
  return _redisClient;
}

// ---------------------------------------------------------------------------
// Queue singleton
// ---------------------------------------------------------------------------

let _queue: Queue<EmailWebhookJobData> | null = null;

/**
 * Returns the singleton BullMQ queue, creating it on first call.
 *
 * Safe to call from Next.js API routes — subsequent calls return the cached
 * instance rather than opening new connections.
 */
export function getEmailWebhookQueue(): Queue<EmailWebhookJobData> {
  if (!_queue) {
    _queue = new Queue<EmailWebhookJobData>(WEBHOOK_QUEUE_NAME, {
      connection: getRedisClient(),
    });
  }
  return _queue;
}

// ---------------------------------------------------------------------------
// Enqueue helper
// ---------------------------------------------------------------------------

/**
 * Adds an email webhook job to the queue with retry and backoff settings.
 *
 * The job name includes `inboxEmailAddressId` for observability (appears in
 * BullMQ dashboards), but does NOT create per-inbox ordering. BullMQ open-source
 * has no job-grouping support — jobs are processed in FIFO order across all
 * inboxes. See worker.ts for details.
 *
 * @param data - The job payload to enqueue.
 */
export async function enqueueEmailWebhookJob(
  data: EmailWebhookJobData,
): Promise<void> {
  const q = getEmailWebhookQueue();
  await q.add(`email-webhook-${data.inboxEmailAddressId}`, data, {
    // maxRetries=3 means 3 retries; BullMQ counts the initial attempt too, so
    // we pass maxRetries + 1 to get 1 initial attempt + 3 retries = 4 total.
    attempts: WEBHOOK_QUEUE_CONFIG.maxRetries + 1,
    backoff: {
      type: "exponential",
      // Initial delay before the first retry; doubles on each subsequent attempt.
      delay: 1_000,
    },
    removeOnComplete: {
      // Keep completed job metadata for 1 hour for observability, then purge.
      age: 3_600,
    },
    removeOnFail: {
      // Keep failed job metadata for 7 days for post-mortem debugging.
      age: 7 * 24 * 3_600,
    },
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Closes the queue and the underlying Redis connection.
 *
 * Call this during process shutdown (SIGTERM/SIGINT) to allow in-flight
 * operations to finish before the connection drops.
 */
export async function closeQueueConnections(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
  if (_redisClient) {
    await _redisClient.quit();
    _redisClient = null;
  }
}
