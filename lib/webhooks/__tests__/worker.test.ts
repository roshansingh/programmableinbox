/**
 * Unit tests for lib/webhooks/worker.ts
 *
 * BullMQ, ioredis, and all external dependencies are mocked so no real Redis
 * or database connection is needed.
 *
 * The key challenge: `processEmailWebhookJob` is a private function reference
 * passed to `new Worker(name, processor, opts)`. The BullMQ Worker mock
 * captures that processor so each test can invoke it directly and assert on
 * behaviour, without spawning a real worker loop.
 *
 * Singleton state (_worker) is reset between tests via vi.resetModules() +
 * dynamic import() — the same pattern used in queue.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { EmailWebhookJobData } from '../queue';

// ---------------------------------------------------------------------------
// BullMQ Worker mock
//
// Captures the processor passed to `new Worker(name, processor, opts)` so
// tests can call it directly. Exposes spies for on/close/waitUntilReady.
// ---------------------------------------------------------------------------

type JobProcessor = (job: Job<EmailWebhookJobData>) => Promise<void>;

let capturedProcessor: JobProcessor | null = null;

const mockWorkerOn = vi.fn();
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
const mockWorkerWaitUntilReady = vi.fn().mockResolvedValue(undefined);

const MockWorker = vi.fn().mockImplementation(
  function (_name: string, processor: JobProcessor, _opts: unknown) {
    capturedProcessor = processor;
    (this as any).on = mockWorkerOn;
    (this as any).close = mockWorkerClose;
    (this as any).waitUntilReady = mockWorkerWaitUntilReady;
  },
);

vi.mock('bullmq', () => ({ Worker: MockWorker }));

// ---------------------------------------------------------------------------
// ioredis mock — worker creates its own Redis connection
// ---------------------------------------------------------------------------

const MockRedis = vi.fn().mockImplementation(function () {
  // minimal stub; worker only passes it as `connection` option to BullMQ
});

vi.mock('ioredis', () => ({ Redis: MockRedis, default: MockRedis }));

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

const mockFindFirst = vi.fn();
const mockDeadLetterUpsert = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db', () => ({
  prisma: {
    emailMessage: { findFirst: mockFindFirst },
    emailJobDeadLetter: { upsert: mockDeadLetterUpsert },
  },
}));

// ---------------------------------------------------------------------------
// storeIncomingEmail + dispatchAutomationsForEmail mocks
// ---------------------------------------------------------------------------

const mockStoreIncomingEmail = vi.fn();
const mockDispatchAutomationsForEmail = vi.fn().mockResolvedValue([]);

vi.mock('@/app/api/v1/webhooks/email/route', () => ({
  storeIncomingEmail: (...args: unknown[]) => mockStoreIncomingEmail(...args),
  ResendEmailData: {},
}));

vi.mock('@/lib/automations/dispatcher', () => ({
  dispatchAutomationsForEmail: (...args: unknown[]) =>
    mockDispatchAutomationsForEmail(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-imports worker.ts with a fresh module registry (resets _worker singleton). */
async function freshImport() {
  vi.resetModules();
  // Re-apply mocks for the fresh module graph after resetModules.
  vi.mock('bullmq', () => ({ Worker: MockWorker }));
  vi.mock('ioredis', () => ({ Redis: MockRedis, default: MockRedis }));
  vi.mock('@/lib/db', () => ({
    prisma: {
      emailMessage: { findFirst: mockFindFirst },
      emailJobDeadLetter: { upsert: mockDeadLetterUpsert },
    },
  }));
  vi.mock('@/app/api/v1/webhooks/email/route', () => ({
    storeIncomingEmail: (...args: unknown[]) => mockStoreIncomingEmail(...args),
    ResendEmailData: {},
  }));
  vi.mock('@/lib/automations/dispatcher', () => ({
    dispatchAutomationsForEmail: (...args: unknown[]) =>
      mockDispatchAutomationsForEmail(...args),
  }));

  capturedProcessor = null;
  return import('../worker');
}

/**
 * Builds a minimal fake BullMQ Job for a given attemptsMade / maxAttempts.
 *
 * `job.opts.attempts` mirrors what `enqueueEmailWebhookJob` sets (maxRetries+1).
 * The default here is 4 (3 retries + 1 initial), matching WEBHOOK_QUEUE_CONFIG
 * defaults.
 */
function makeJob(
  overrides: Partial<{
    attemptsMade: number;
    maxAttempts: number;
    externalId: string;
    inboxEmailAddressId: string;
    payload: Record<string, unknown>;
  }> = {},
): Job<EmailWebhookJobData> {
  const {
    attemptsMade = 0,
    maxAttempts = 4,
    externalId = 'em_456',
    inboxEmailAddressId = 'inbox_789',
    payload = { from: 'sender@example.com', subject: 'Test' },
  } = overrides;

  return {
    id: 'job_123',
    attemptsMade,
    opts: { attempts: maxAttempts },
    data: { externalId, inboxEmailAddressId, payload },
  } as unknown as Job<EmailWebhookJobData>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Email Webhook Worker (lib/webhooks/worker.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerClose.mockResolvedValue(undefined);
    mockWorkerWaitUntilReady.mockResolvedValue(undefined);
    mockDeadLetterUpsert.mockResolvedValue(undefined);
    mockDispatchAutomationsForEmail.mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // getEmailWebhookWorker — singleton
  // -------------------------------------------------------------------------

  describe('getEmailWebhookWorker', () => {
    it('returns a Worker instance', async () => {
      const { getEmailWebhookWorker } = await freshImport();
      const worker = getEmailWebhookWorker();
      expect(worker).toBeDefined();
    });

    it('returns the same instance on repeated calls (singleton)', async () => {
      const { getEmailWebhookWorker } = await freshImport();
      const w1 = getEmailWebhookWorker();
      const w2 = getEmailWebhookWorker();
      expect(w1).toBe(w2);
    });

    it('constructs Worker exactly once per module lifecycle', async () => {
      MockWorker.mockClear();
      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();
      getEmailWebhookWorker();
      expect(MockWorker).toHaveBeenCalledTimes(1);
    });

    it('constructs Worker with the correct queue name', async () => {
      MockWorker.mockClear();
      const { getEmailWebhookWorker, WEBHOOK_QUEUE_NAME } = await freshImport() as any;
      getEmailWebhookWorker();
      expect(MockWorker).toHaveBeenCalledWith(
        WEBHOOK_QUEUE_NAME ?? 'email-webhook-jobs',
        expect.any(Function),
        expect.anything(),
      );
    });

    it('passes a dedicated ioredis connection (not the shared queue connection)', async () => {
      MockWorker.mockClear();
      MockRedis.mockClear();
      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();
      // Worker creates its own Redis instance — MockRedis must have been called.
      expect(MockRedis).toHaveBeenCalledTimes(1);
      // The connection passed to Worker must be a MockRedis instance.
      const workerOpts = MockWorker.mock.calls[0][2] as any;
      expect(workerOpts.connection).toBeDefined();
    });

    it('registers "failed" event handler', async () => {
      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();
      const registeredEvents = mockWorkerOn.mock.calls.map((c) => c[0]);
      expect(registeredEvents).toContain('failed');
    });

    it('registers "completed" event handler', async () => {
      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();
      const registeredEvents = mockWorkerOn.mock.calls.map((c) => c[0]);
      expect(registeredEvents).toContain('completed');
    });

    it('passes concurrency from WEBHOOK_QUEUE_CONFIG', async () => {
      MockWorker.mockClear();
      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();
      const opts = MockWorker.mock.calls[0][2] as any;
      expect(typeof opts.concurrency).toBe('number');
      expect(opts.concurrency).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Job Processing — happy path
  // -------------------------------------------------------------------------

  describe('Job Processing — happy path', () => {
    it('calls prisma.emailMessage.findFirst with correct idempotency key', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_1' }]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { externalId: 'em_456', inboxEmailAddressId: 'inbox_789' },
        select: { id: true },
      });
    });

    it('calls storeIncomingEmail with the payload and inbox filter', async () => {
      const payload = { from: 'a@b.com', subject: 'Hi' };
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_1' }]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob({ payload }));

      expect(mockStoreIncomingEmail).toHaveBeenCalledWith(
        payload,
        ['inbox_789'],
      );
    });

    it('calls dispatchAutomationsForEmail for each stored message', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([
        { id: 'msg_1' },
        { id: 'msg_2' },
      ]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockDispatchAutomationsForEmail).toHaveBeenCalledTimes(2);
      expect(mockDispatchAutomationsForEmail).toHaveBeenCalledWith('msg_1');
      expect(mockDispatchAutomationsForEmail).toHaveBeenCalledWith('msg_2');
    });

    it('logs successful processing', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_1' }]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      const messages = consoleSpy.mock.calls.map((c) => c[0]);
      expect(messages.some((m) => m.includes('fully processed'))).toBe(true);
    });

    it('does not touch dead-letter on success', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_1' }]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockDeadLetterUpsert).not.toHaveBeenCalled();
    });

    it('does not throw on success', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_1' }]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await expect(capturedProcessor!(makeJob())).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency — skip if already stored
  // -------------------------------------------------------------------------

  describe('Idempotency', () => {
    it('skips storeIncomingEmail if email already exists', async () => {
      mockFindFirst.mockResolvedValueOnce({ id: 'msg_existing' });

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockStoreIncomingEmail).not.toHaveBeenCalled();
    });

    it('skips dispatchAutomationsForEmail if email already exists', async () => {
      mockFindFirst.mockResolvedValueOnce({ id: 'msg_existing' });

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockDispatchAutomationsForEmail).not.toHaveBeenCalled();
    });

    it('returns without throwing when email already exists', async () => {
      mockFindFirst.mockResolvedValueOnce({ id: 'msg_existing' });

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await expect(capturedProcessor!(makeJob())).resolves.toBeUndefined();
    });

    it('logs "skipping" when email already exists', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFindFirst.mockResolvedValueOnce({ id: 'msg_existing' });

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      const messages = consoleSpy.mock.calls.map((c) => c[0]);
      expect(messages.some((m) => m.includes('skipping'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Empty store result — inbox removed / already deduplicated
  // -------------------------------------------------------------------------

  describe('Empty storeIncomingEmail result', () => {
    it('skips dispatchAutomationsForEmail when store returns empty array', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockDispatchAutomationsForEmail).not.toHaveBeenCalled();
    });

    it('returns without throwing when store returns empty array', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await expect(capturedProcessor!(makeJob())).resolves.toBeUndefined();
    });

    it('logs that 0 messages were returned', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      const messages = consoleSpy.mock.calls.map((c) => c[0]);
      expect(
        messages.some((m) => typeof m === 'string' && m.includes('0 messages')),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Failure handling — error logging and re-throwing
  // -------------------------------------------------------------------------

  describe('Failure handling', () => {
    it('throws when storeIncomingEmail rejects (so BullMQ retries)', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error('DB write failed'));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await expect(capturedProcessor!(makeJob({ attemptsMade: 0 }))).rejects.toThrow(
        'DB write failed',
      );
    });

    it('throws when dispatchAutomationsForEmail rejects', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_1' }]);
      mockDispatchAutomationsForEmail.mockRejectedValueOnce(
        new Error('Dispatch failed'),
      );

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await expect(capturedProcessor!(makeJob({ attemptsMade: 0 }))).rejects.toThrow(
        'Dispatch failed',
      );
    });

    it('logs the error message on failure', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error('Store failed'));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob({ attemptsMade: 0 })).catch(() => {});

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('error'),
        'Store failed',
      );
    });

    it('does not write dead-letter on non-final attempt', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(
        new Error('Temporary failure'),
      );

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      // attemptsMade=0, maxAttempts=4 → not the final attempt
      await capturedProcessor!(makeJob({ attemptsMade: 0, maxAttempts: 4 })).catch(
        () => {},
      );

      expect(mockDeadLetterUpsert).not.toHaveBeenCalled();
    });

    it('does not write dead-letter on intermediate retry (attemptsMade=1 of 4)', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error('Temp'));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob({ attemptsMade: 1, maxAttempts: 4 })).catch(
        () => {},
      );

      expect(mockDeadLetterUpsert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Dead-letter queue — final attempt behaviour
  // -------------------------------------------------------------------------

  describe('Dead-letter queue', () => {
    it('writes to dead-letter on the final attempt', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(
        new Error('Persistent failure'),
      );

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      // attemptsMade=3, maxAttempts=4 → isFinalAttempt: 3+1 >= 4 ✓
      await capturedProcessor!(
        makeJob({ attemptsMade: 3, maxAttempts: 4 }),
      ).catch(() => {});

      expect(mockDeadLetterUpsert).toHaveBeenCalledTimes(1);
    });

    it('upserts with the compound unique key', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error('fail'));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(
        makeJob({ attemptsMade: 3, maxAttempts: 4 }),
      ).catch(() => {});

      expect(mockDeadLetterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            externalId_inboxEmailAddressId: {
              externalId: 'em_456',
              inboxEmailAddressId: 'inbox_789',
            },
          },
        }),
      );
    });

    it('includes the error message in the create payload', async () => {
      const errorMessage = 'Custom failure reason';
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error(errorMessage));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(
        makeJob({ attemptsMade: 3, maxAttempts: 4 }),
      ).catch(() => {});

      expect(mockDeadLetterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            error: errorMessage,
          }),
        }),
      );
    });

    it('includes the error message in the update payload', async () => {
      const errorMessage = 'Custom failure reason';
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error(errorMessage));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(
        makeJob({ attemptsMade: 3, maxAttempts: 4 }),
      ).catch(() => {});

      expect(mockDeadLetterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            error: errorMessage,
          }),
        }),
      );
    });

    it('records the correct attemptCount in the create payload', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error('fail'));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(
        makeJob({ attemptsMade: 3, maxAttempts: 4 }),
      ).catch(() => {});

      expect(mockDeadLetterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            // attemptsMade + 1 = 4
            attemptCount: 4,
          }),
        }),
      );
    });

    it('stores the original payload in the dead-letter create record', async () => {
      const payload = { from: 'x@y.com', subject: 'Dead' };
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error('fail'));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(
        makeJob({ attemptsMade: 3, maxAttempts: 4, payload }),
      ).catch(() => {});

      expect(mockDeadLetterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            payload,
          }),
        }),
      );
    });

    it('still throws after dead-letter upsert so BullMQ records terminal failure', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(
        new Error('Persistent failure'),
      );

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await expect(
        capturedProcessor!(makeJob({ attemptsMade: 3, maxAttempts: 4 })),
      ).rejects.toThrow('Persistent failure');
    });

    it('logs dead-letter write', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error('fail'));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(
        makeJob({ attemptsMade: 3, maxAttempts: 4 }),
      ).catch(() => {});

      const messages = consoleSpy.mock.calls.map((c) => c[0]);
      expect(messages.some((m) => m.includes('dead-letter'))).toBe(true);
    });

    it('survives a dead-letter upsert error and still re-throws the original error', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(
        new Error('Original error'),
      );
      mockDeadLetterUpsert.mockRejectedValueOnce(new Error('DL write failed'));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      // Should throw the original error, not the dead-letter write error.
      await expect(
        capturedProcessor!(makeJob({ attemptsMade: 3, maxAttempts: 4 })),
      ).rejects.toThrow('Original error');
    });

    it('logs the dead-letter write failure when upsert throws', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error('fail'));
      mockDeadLetterUpsert.mockRejectedValueOnce(new Error('DL write failed'));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(
        makeJob({ attemptsMade: 3, maxAttempts: 4 }),
      ).catch(() => {});

      const calls = errorSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((m) => m.includes('dead-letter'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('Edge cases', () => {
    it('handles a non-Error thrown value (string) and still dead-letters on final attempt', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      // Throw a raw string instead of an Error instance
      mockStoreIncomingEmail.mockRejectedValueOnce('String error');

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(
        makeJob({ attemptsMade: 3, maxAttempts: 4 }),
      ).catch(() => {});

      expect(mockDeadLetterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            error: 'String error',
          }),
        }),
      );
    });

    it('handles a non-Error thrown value (string) and re-throws', async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce('String error');

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await expect(
        capturedProcessor!(makeJob({ attemptsMade: 3, maxAttempts: 4 })),
      ).rejects.toBe('String error');
    });

    it('passes a malformed payload through without throwing before the store step', async () => {
      // findFirst returns null so we proceed to storeIncomingEmail
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error('Invalid payload'));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      // The processor should fail at storeIncomingEmail, dead-letter on final attempt
      await capturedProcessor!(
        makeJob({
          payload: 'not an object' as unknown as Record<string, unknown>,
          attemptsMade: 3,
          maxAttempts: 4,
        }),
      ).catch(() => {});

      expect(mockDeadLetterUpsert).toHaveBeenCalled();
    });

    it('uses WEBHOOK_QUEUE_CONFIG.maxRetries + 1 as fallback when job.opts.attempts is undefined', async () => {
      // Simulate a job whose opts.attempts is undefined (edge case in BullMQ)
      mockFindFirst.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error('fail'));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      const job = makeJob({ attemptsMade: 3 });
      (job as any).opts = {}; // remove `attempts` key

      // Default WEBHOOK_QUEUE_CONFIG.maxRetries is 3 → maxAttempts falls back to 3+1=4
      // attemptsMade=3 → 3+1=4 >= 4 → isFinalAttempt=true
      await capturedProcessor!(job).catch(() => {});

      expect(mockDeadLetterUpsert).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // startEmailWebhookWorker
  // -------------------------------------------------------------------------

  describe('startEmailWebhookWorker', () => {
    it('calls waitUntilReady on the worker', async () => {
      const { startEmailWebhookWorker } = await freshImport();
      await startEmailWebhookWorker();
      expect(mockWorkerWaitUntilReady).toHaveBeenCalledTimes(1);
    });

    it('logs that the worker started', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { startEmailWebhookWorker } = await freshImport();
      await startEmailWebhookWorker();
      const messages = consoleSpy.mock.calls.map((c) => c[0]);
      expect(messages.some((m) => m.includes('started'))).toBe(true);
    });

    it('resolves after waitUntilReady resolves', async () => {
      const { startEmailWebhookWorker } = await freshImport();
      await expect(startEmailWebhookWorker()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // closeEmailWebhookWorker — graceful shutdown
  // -------------------------------------------------------------------------

  describe('closeEmailWebhookWorker', () => {
    it('calls close() on the worker', async () => {
      const { getEmailWebhookWorker, closeEmailWebhookWorker } =
        await freshImport();
      getEmailWebhookWorker(); // ensure worker is initialised
      await closeEmailWebhookWorker();
      expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    });

    it('logs that the worker closed', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { getEmailWebhookWorker, closeEmailWebhookWorker } =
        await freshImport();
      getEmailWebhookWorker();
      await closeEmailWebhookWorker();
      const messages = consoleSpy.mock.calls.map((c) => c[0]);
      expect(messages.some((m) => m.includes('closed'))).toBe(true);
    });

    it('is a no-op when worker was never initialised', async () => {
      const { closeEmailWebhookWorker } = await freshImport();
      // Don't call getEmailWebhookWorker() first
      await expect(closeEmailWebhookWorker()).resolves.toBeUndefined();
      expect(mockWorkerClose).not.toHaveBeenCalled();
    });

    it('is idempotent — second call does not throw', async () => {
      const { getEmailWebhookWorker, closeEmailWebhookWorker } =
        await freshImport();
      getEmailWebhookWorker();
      await closeEmailWebhookWorker();
      await expect(closeEmailWebhookWorker()).resolves.toBeUndefined();
    });

    it('does not call close() a second time after the worker has been nulled', async () => {
      const { getEmailWebhookWorker, closeEmailWebhookWorker } =
        await freshImport();
      getEmailWebhookWorker();
      await closeEmailWebhookWorker();
      mockWorkerClose.mockClear();
      await closeEmailWebhookWorker();
      expect(mockWorkerClose).not.toHaveBeenCalled();
    });

    it('creates a new worker after close (singleton is re-initialised)', async () => {
      MockWorker.mockClear();
      const { getEmailWebhookWorker, closeEmailWebhookWorker } =
        await freshImport();
      getEmailWebhookWorker();
      await closeEmailWebhookWorker();
      // After close _worker is null, so next call creates a fresh instance.
      getEmailWebhookWorker();
      expect(MockWorker).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // "failed" event handler logging
  // -------------------------------------------------------------------------

  describe('"failed" event handler', () => {
    it('logs the job id and attempt count on failure', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker(); // registers event handlers

      fireEvent('failed', {
        id: 'job_99',
        attemptsMade: 2,
        data: { externalId: 'em_1', inboxEmailAddressId: 'inbox_1', payload: {} },
        opts: { attempts: 4 },
      } as unknown as Job<EmailWebhookJobData>, new Error('kaboom'));

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('job_99'),
        expect.any(String),
      );
    });

    it('does not throw when job argument is undefined', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      expect(() =>
        fireEvent('failed', undefined as any, new Error('kaboom')),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // "completed" event handler logging
  // -------------------------------------------------------------------------

  describe('"completed" event handler', () => {
    it('logs the job id and externalId on completion', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      fireEvent('completed', {
        id: 'job_42',
        attemptsMade: 0,
        data: { externalId: 'em_77', inboxEmailAddressId: 'inbox_1', payload: {} },
        opts: { attempts: 4 },
      } as unknown as Job<EmailWebhookJobData>);

      const messages = consoleSpy.mock.calls.map((c) => c[0]);
      expect(messages.some((m) => m.includes('job_42') && m.includes('em_77'))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Helper — fires a named event by looking up the most-recently registered
// handler in mockWorkerOn.mock.calls. Each event-handler test calls
// freshImport() + getEmailWebhookWorker() first, which populates mock.calls
// for that test's module scope.
// ---------------------------------------------------------------------------

function fireEvent(eventName: string, ...args: unknown[]): void {
  const call = mockWorkerOn.mock.calls.find((c) => c[0] === eventName);
  if (!call) {
    throw new Error(
      `No handler registered for event "${eventName}". ` +
        'Call getEmailWebhookWorker() before fireEvent().',
    );
  }
  const handler = call[1] as (...a: unknown[]) => void;
  handler(...args);
}
