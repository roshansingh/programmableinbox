/**
 * Unit tests for lib/webhooks/queue.ts
 *
 * BullMQ and ioredis are mocked so no real Redis connection is needed.
 * Singleton state is reset between tests with vi.resetModules() + dynamic
 * import() — the ESM-compatible alternative to manipulating require.cache.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import of the module under test.
// ---------------------------------------------------------------------------

// BullMQ Queue mock: captures constructor calls and exposes spies on add/close.
const mockQueueAdd = vi.fn().mockResolvedValue(undefined);
const mockQueueClose = vi.fn().mockResolvedValue(undefined);
const MockQueue = vi.fn().mockImplementation(function (name: string, opts: unknown) {
  (this as any).name = name;
  (this as any).opts = opts;
  (this as any).add = mockQueueAdd;
  (this as any).close = mockQueueClose;
});

vi.mock('bullmq', () => ({ Queue: MockQueue }));

// ioredis Redis mock: exposes spies on quit.
const mockRedisQuit = vi.fn().mockResolvedValue(undefined);
const MockRedis = vi.fn().mockImplementation(function (opts: unknown) {
  (this as any).opts = opts;
  (this as any).quit = mockRedisQuit;
});

vi.mock('ioredis', () => ({ Redis: MockRedis }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-imports queue.ts with a clean module registry (resets singleton state). */
async function freshImport() {
  vi.resetModules();
  return import('../queue');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Queue Client (lib/webhooks/queue.ts)', () => {
  // Snapshot of original env vars so we can restore them after each test.
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore env to original state before each test. `freshImport()` resets
    // the module registry, which also gives lib/config a fresh (empty) memo, so
    // no explicit resetConfigCache is needed here.
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    // Close any open connections created during the test.
    try {
      const mod = await import('../queue');
      await mod.closeQueueConnections();
    } catch {
      // ignore — module may have been reset
    }
    process.env = { ...originalEnv };
  });

  // -------------------------------------------------------------------------
  // WEBHOOK_QUEUE_NAME
  // -------------------------------------------------------------------------

  describe('WEBHOOK_QUEUE_NAME', () => {
    it('should equal "email-webhook-jobs"', async () => {
      const { WEBHOOK_QUEUE_NAME } = await freshImport();
      expect(WEBHOOK_QUEUE_NAME).toBe('email-webhook-jobs');
    });
  });

  // -------------------------------------------------------------------------
  // WEBHOOK_QUEUE_CONFIG — defaults and env-var parsing
  // -------------------------------------------------------------------------

  describe('WEBHOOK_QUEUE_CONFIG', () => {
    it('has default maxRetries of 3 when env var is absent', async () => {
      delete process.env.WEBHOOK_QUEUE_MAX_RETRIES;
      const { WEBHOOK_QUEUE_CONFIG } = await freshImport();
      expect(WEBHOOK_QUEUE_CONFIG.maxRetries).toBe(3);
    });

    it('has default concurrencyPerInbox of 5 when env var is absent', async () => {
      delete process.env.WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX;
      const { WEBHOOK_QUEUE_CONFIG } = await freshImport();
      expect(WEBHOOK_QUEUE_CONFIG.concurrencyPerInbox).toBe(5);
    });

    it('parses WEBHOOK_QUEUE_MAX_RETRIES from env', async () => {
      process.env.WEBHOOK_QUEUE_MAX_RETRIES = '5';
      const { WEBHOOK_QUEUE_CONFIG } = await freshImport();
      expect(WEBHOOK_QUEUE_CONFIG.maxRetries).toBe(5);
    });

    // A typo'd tuning value used to be indistinguishable from an unset one:
    // parsePositiveInt returned the fallback for anything it could not parse,
    // so the operator got 3 retries and no indication their setting was ignored.
    it.each(['invalid', 'NaN', '-5', '0', '3.5', '1e2'])(
      'throws on WEBHOOK_QUEUE_MAX_RETRIES=%s rather than silently using 3',
      async (raw) => {
        process.env.WEBHOOK_QUEUE_MAX_RETRIES = raw;
        const { WEBHOOK_QUEUE_CONFIG } = await freshImport();
        expect(() => WEBHOOK_QUEUE_CONFIG.maxRetries).toThrow(/WEBHOOK_QUEUE_MAX_RETRIES/);
      },
    );

    it('rejects a value above the sanity bound', async () => {
      process.env.WEBHOOK_QUEUE_MAX_RETRIES = '101';
      const { WEBHOOK_QUEUE_CONFIG } = await freshImport();
      expect(() => WEBHOOK_QUEUE_CONFIG.maxRetries).toThrow(/WEBHOOK_QUEUE_MAX_RETRIES/);
    });

    it('treats an empty WEBHOOK_QUEUE_MAX_RETRIES as unset', async () => {
      // `FOO=` in a .env file means "not configured", not "configured badly".
      process.env.WEBHOOK_QUEUE_MAX_RETRIES = '';
      const { WEBHOOK_QUEUE_CONFIG } = await freshImport();
      expect(WEBHOOK_QUEUE_CONFIG.maxRetries).toBe(3);
    });

    it('parses WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX from env', async () => {
      process.env.WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX = '10';
      const { WEBHOOK_QUEUE_CONFIG } = await freshImport();
      expect(WEBHOOK_QUEUE_CONFIG.concurrencyPerInbox).toBe(10);
    });

    it.each(['0', '-1', 'lots', '1001'])(
      'throws on WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX=%s rather than silently using 5',
      async (raw) => {
        process.env.WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX = raw;
        const { WEBHOOK_QUEUE_CONFIG } = await freshImport();
        expect(() => WEBHOOK_QUEUE_CONFIG.concurrencyPerInbox).toThrow(
          /WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX/,
        );
      },
    );

    it('is lazy — importing the module with a bad value does not throw', async () => {
      // next build evaluates every route module, and these route modules import
      // the queue. A module-load read would fail the build instead of the
      // misconfigured deployment.
      process.env.WEBHOOK_QUEUE_MAX_RETRIES = 'nonsense';
      await expect(freshImport()).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // buildRedisOptions
  // -------------------------------------------------------------------------

  describe('buildRedisOptions', () => {
    it('returns host/port parsed from REDIS_URL', async () => {
      process.env.REDIS_URL = 'redis://myhost:1234';
      const { buildRedisOptions } = await freshImport();
      const opts = buildRedisOptions();
      expect(opts.host).toBe('myhost');
      expect(opts.port).toBe(1234);
    });

    it('defaults to localhost:6379 when REDIS_URL is absent', async () => {
      // The default lives in lib/config/schema.ts (DEFAULT_REDIS_URL) and is
      // written exactly once, rather than here and in replay-rate-limit.ts.
      delete process.env.REDIS_URL;
      const { buildRedisOptions } = await freshImport();
      const opts = buildRedisOptions();
      expect(opts.host).toBe('localhost');
      expect(opts.port).toBe(6379);
    });

    it.each(['not-a-url', 'http://localhost:6379', 'localhost:6379'])(
      'throws on REDIS_URL=%s at config read rather than at first connection',
      async (raw) => {
        // Previously `new URL()` threw from inside buildRedisOptions when the
        // queue first dialled Redis, and a hostless URL was quietly rewritten
        // to 127.0.0.1.
        process.env.REDIS_URL = raw;
        const { buildRedisOptions } = await freshImport();
        expect(() => buildRedisOptions()).toThrow(/REDIS_URL/);
      },
    );

    it('includes password when present in REDIS_URL', async () => {
      process.env.REDIS_URL = 'redis://:s3cr3t@myhost:6379';
      const { buildRedisOptions } = await freshImport();
      const opts = buildRedisOptions();
      expect(opts.password).toBe('s3cr3t');
    });

    it('omits password key when not present in REDIS_URL', async () => {
      process.env.REDIS_URL = 'redis://myhost:6379';
      const { buildRedisOptions } = await freshImport();
      const opts = buildRedisOptions();
      expect(opts).not.toHaveProperty('password');
    });

    it('parses db index from URL path', async () => {
      process.env.REDIS_URL = 'redis://myhost:6379/2';
      const { buildRedisOptions } = await freshImport();
      const opts = buildRedisOptions();
      expect(opts.db).toBe(2);
    });

    it('omits db key when path is "/"', async () => {
      process.env.REDIS_URL = 'redis://myhost:6379/';
      const { buildRedisOptions } = await freshImport();
      const opts = buildRedisOptions();
      expect(opts).not.toHaveProperty('db');
    });

    it('sets maxRetriesPerRequest to null for BullMQ compatibility', async () => {
      const { buildRedisOptions } = await freshImport();
      const opts = buildRedisOptions();
      expect(opts.maxRetriesPerRequest).toBeNull();
    });

    it('disables the ready check', async () => {
      const { buildRedisOptions } = await freshImport();
      const opts = buildRedisOptions();
      expect(opts.enableReadyCheck).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getRedisClient — singleton
  // -------------------------------------------------------------------------

  describe('getRedisClient', () => {
    it('returns a Redis instance', async () => {
      const { getRedisClient } = await freshImport();
      const client = getRedisClient();
      expect(client).toBeDefined();
    });

    it('returns the same instance on repeated calls (singleton)', async () => {
      const { getRedisClient } = await freshImport();
      const client1 = getRedisClient();
      const client2 = getRedisClient();
      expect(client1).toBe(client2);
    });

    it('constructs Redis exactly once per module lifecycle', async () => {
      MockRedis.mockClear();
      const { getRedisClient } = await freshImport();
      getRedisClient();
      getRedisClient();
      expect(MockRedis).toHaveBeenCalledTimes(1);
    });

    it('passes parsed options to the Redis constructor', async () => {
      process.env.REDIS_URL = 'redis://custom-host:9999';
      MockRedis.mockClear();
      const { getRedisClient } = await freshImport();
      getRedisClient();
      expect(MockRedis).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'custom-host', port: 9999 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getEmailWebhookQueue — singleton
  // -------------------------------------------------------------------------

  describe('getEmailWebhookQueue', () => {
    it('returns a Queue instance', async () => {
      const { getEmailWebhookQueue } = await freshImport();
      const queue = getEmailWebhookQueue();
      expect(queue).toBeDefined();
    });

    it('returns the same instance on repeated calls (singleton)', async () => {
      const { getEmailWebhookQueue } = await freshImport();
      const queue1 = getEmailWebhookQueue();
      const queue2 = getEmailWebhookQueue();
      expect(queue1).toBe(queue2);
    });

    it('constructs Queue exactly once per module lifecycle', async () => {
      MockQueue.mockClear();
      const { getEmailWebhookQueue } = await freshImport();
      getEmailWebhookQueue();
      getEmailWebhookQueue();
      expect(MockQueue).toHaveBeenCalledTimes(1);
    });

    it('creates Queue with WEBHOOK_QUEUE_NAME', async () => {
      MockQueue.mockClear();
      const { getEmailWebhookQueue, WEBHOOK_QUEUE_NAME } = await freshImport();
      getEmailWebhookQueue();
      expect(MockQueue).toHaveBeenCalledWith(
        WEBHOOK_QUEUE_NAME,
        expect.anything(),
      );
    });

    it('passes the Redis client as the connection option', async () => {
      MockQueue.mockClear();
      const { getEmailWebhookQueue, getRedisClient } = await freshImport();
      const client = getRedisClient();
      getEmailWebhookQueue();
      expect(MockQueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ connection: client }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // enqueueEmailWebhookJob
  // -------------------------------------------------------------------------

  describe('enqueueEmailWebhookJob', () => {
    const baseJobData = {
      externalId: 'em_123',
      inboxEmailAddressId: 'inbox_456',
      payload: { from: 'test@example.com', subject: 'Test' } as Record<string, unknown>,
    };

    it('calls queue.add once', async () => {
      const { enqueueEmailWebhookJob } = await freshImport();
      await enqueueEmailWebhookJob(baseJobData);
      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    });

    it('job name includes "email-webhook-" prefix', async () => {
      const { enqueueEmailWebhookJob } = await freshImport();
      await enqueueEmailWebhookJob(baseJobData);
      expect(mockQueueAdd).toHaveBeenCalledWith(
        expect.stringContaining('email-webhook-'),
        expect.anything(),
        expect.anything(),
      );
    });

    it('job name includes the inboxEmailAddressId', async () => {
      const { enqueueEmailWebhookJob } = await freshImport();
      await enqueueEmailWebhookJob(baseJobData);
      expect(mockQueueAdd).toHaveBeenCalledWith(
        expect.stringContaining('inbox_456'),
        expect.anything(),
        expect.anything(),
      );
    });

    it('passes the full job data as the second argument', async () => {
      const { enqueueEmailWebhookJob } = await freshImport();
      await enqueueEmailWebhookJob(baseJobData);
      expect(mockQueueAdd).toHaveBeenCalledWith(
        expect.anything(),
        baseJobData,
        expect.anything(),
      );
    });

    it('sets attempts to maxRetries + 1', async () => {
      const { enqueueEmailWebhookJob, WEBHOOK_QUEUE_CONFIG } = await freshImport();
      await enqueueEmailWebhookJob(baseJobData);
      const opts = mockQueueAdd.mock.calls[0][2];
      expect(opts.attempts).toBe(WEBHOOK_QUEUE_CONFIG.maxRetries + 1);
    });

    it('sets exponential backoff with 1000ms initial delay', async () => {
      const { enqueueEmailWebhookJob } = await freshImport();
      await enqueueEmailWebhookJob(baseJobData);
      const opts = mockQueueAdd.mock.calls[0][2];
      expect(opts.backoff).toEqual({ type: 'exponential', delay: 1000 });
    });

    it('sets removeOnComplete with an age property', async () => {
      const { enqueueEmailWebhookJob } = await freshImport();
      await enqueueEmailWebhookJob(baseJobData);
      const opts = mockQueueAdd.mock.calls[0][2];
      expect(opts.removeOnComplete).toBeDefined();
      expect(typeof opts.removeOnComplete.age).toBe('number');
    });

    it('sets removeOnFail with an age property', async () => {
      const { enqueueEmailWebhookJob } = await freshImport();
      await enqueueEmailWebhookJob(baseJobData);
      const opts = mockQueueAdd.mock.calls[0][2];
      expect(opts.removeOnFail).toBeDefined();
      expect(typeof opts.removeOnFail.age).toBe('number');
    });

    it('removeOnFail retention is longer than removeOnComplete retention', async () => {
      const { enqueueEmailWebhookJob } = await freshImport();
      await enqueueEmailWebhookJob(baseJobData);
      const opts = mockQueueAdd.mock.calls[0][2];
      expect(opts.removeOnFail.age).toBeGreaterThan(opts.removeOnComplete.age);
    });

    it('respects custom maxRetries from env', async () => {
      process.env.WEBHOOK_QUEUE_MAX_RETRIES = '7';
      const { enqueueEmailWebhookJob } = await freshImport();
      await enqueueEmailWebhookJob(baseJobData);
      const opts = mockQueueAdd.mock.calls[0][2];
      // 7 retries → 8 total attempts
      expect(opts.attempts).toBe(8);
    });

    it('propagates rejection from queue.add', async () => {
      mockQueueAdd.mockRejectedValueOnce(new Error('Redis unavailable'));
      const { enqueueEmailWebhookJob } = await freshImport();
      await expect(enqueueEmailWebhookJob(baseJobData)).rejects.toThrow('Redis unavailable');
    });
  });

  // -------------------------------------------------------------------------
  // closeQueueConnections
  // -------------------------------------------------------------------------

  describe('closeQueueConnections', () => {
    it('calls close() on the Queue', async () => {
      const { getEmailWebhookQueue, closeQueueConnections } = await freshImport();
      getEmailWebhookQueue(); // ensure queue is created
      await closeQueueConnections();
      expect(mockQueueClose).toHaveBeenCalledTimes(1);
    });

    it('calls quit() on the Redis client', async () => {
      const { getRedisClient, closeQueueConnections } = await freshImport();
      getRedisClient(); // ensure client is created
      await closeQueueConnections();
      expect(mockRedisQuit).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when no connections are open', async () => {
      // Neither client nor queue created before closing.
      const { closeQueueConnections } = await freshImport();
      await expect(closeQueueConnections()).resolves.toBeUndefined();
      expect(mockQueueClose).not.toHaveBeenCalled();
      expect(mockRedisQuit).not.toHaveBeenCalled();
    });

    it('is idempotent — second call does not throw', async () => {
      const { getEmailWebhookQueue, closeQueueConnections } = await freshImport();
      getEmailWebhookQueue();
      await closeQueueConnections();
      await expect(closeQueueConnections()).resolves.toBeUndefined();
    });

    it('second close does not call quit/close again', async () => {
      const { getEmailWebhookQueue, getRedisClient, closeQueueConnections } = await freshImport();
      getEmailWebhookQueue();
      getRedisClient();
      await closeQueueConnections();
      mockQueueClose.mockClear();
      mockRedisQuit.mockClear();
      await closeQueueConnections();
      expect(mockQueueClose).not.toHaveBeenCalled();
      expect(mockRedisQuit).not.toHaveBeenCalled();
    });
  });
});
