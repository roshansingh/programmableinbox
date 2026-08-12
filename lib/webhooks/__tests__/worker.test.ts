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
// @opentelemetry/api mock — captures the span the worker starts
// ---------------------------------------------------------------------------

const startActiveSpanMock = vi.fn((_name: string, fn: (span: unknown) => unknown) => {
  const fakeSpan = { setAttribute: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), end: vi.fn() };
  return fn(fakeSpan);
});

vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/api')>();
  return {
    ...actual,
    trace: { ...actual.trace, getTracer: () => ({ startActiveSpan: startActiveSpanMock }) },
  };
});

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn().mockResolvedValue({});
const mockDeadLetterUpsert = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db', () => ({
  prisma: {
    emailMessage: { findUnique: mockFindUnique, update: mockUpdate },
    emailJobDeadLetter: { upsert: mockDeadLetterUpsert },
  },
}));

// ---------------------------------------------------------------------------
// storeIncomingEmail + dispatchAutomationsForEmail + enrichMessage mocks
// ---------------------------------------------------------------------------

const mockStoreIncomingEmail = vi.fn();
const mockDispatchAutomationsForEmail = vi.fn().mockResolvedValue([]);
const mockEnrichMessage = vi.fn().mockResolvedValue(undefined);

vi.mock('@/app/api/webhooks/email/route', () => ({
  storeIncomingEmail: (...args: unknown[]) => mockStoreIncomingEmail(...args),
  ResendEmailData: {},
}));

vi.mock('@/lib/automations/dispatcher', () => ({
  dispatchAutomationsForEmail: (...args: unknown[]) =>
    mockDispatchAutomationsForEmail(...args),
}));

vi.mock('@/lib/llm/enrichment', () => ({
  enrichMessage: (...args: unknown[]) => mockEnrichMessage(...args),
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
  vi.mock('@opentelemetry/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@opentelemetry/api')>();
    return {
      ...actual,
      trace: { ...actual.trace, getTracer: () => ({ startActiveSpan: startActiveSpanMock }) },
    };
  });
  vi.mock('@/lib/db', () => ({
    prisma: {
      emailMessage: { findUnique: mockFindUnique, update: mockUpdate },
      emailJobDeadLetter: { upsert: mockDeadLetterUpsert },
    },
  }));
  vi.mock('@/app/api/webhooks/email/route', () => ({
    storeIncomingEmail: (...args: unknown[]) => mockStoreIncomingEmail(...args),
    ResendEmailData: {},
  }));
  vi.mock('@/lib/automations/dispatcher', () => ({
    dispatchAutomationsForEmail: (...args: unknown[]) =>
      mockDispatchAutomationsForEmail(...args),
  }));
  vi.mock('@/lib/llm/enrichment', () => ({
    enrichMessage: (...args: unknown[]) => mockEnrichMessage(...args),
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
    mockUpdate.mockResolvedValue({});
    mockEnrichMessage.mockResolvedValue(true);
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
    it('calls prisma.emailMessage.findUnique with the composite unique key', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_1' }]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { externalId_inboxEmailAddressId: { externalId: 'em_456', inboxEmailAddressId: 'inbox_789' } },
        select: { id: true, dispatchedAt: true, enrichedAt: true },
      });
    });

    it('calls storeIncomingEmail with the payload and inbox filter', async () => {
      const payload = { from: 'a@b.com', subject: 'Hi' };
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_1' }]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      const messages = consoleSpy.mock.calls.map((c) => c[0]);
      expect(messages.some((m) => m.includes('fully processed'))).toBe(true);
    });

    it('does not touch dead-letter on success', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_1' }]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockDeadLetterUpsert).not.toHaveBeenCalled();
    });

    it('does not throw on success', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_1' }]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await expect(capturedProcessor!(makeJob())).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Job Processing — tracing
  // -------------------------------------------------------------------------

  describe('Job Processing — tracing', () => {
    it('wraps job processing in an OTel span named webhook.process_email_job', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_1' }]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(startActiveSpanMock).toHaveBeenCalledWith(
        'webhook.process_email_job',
        expect.any(Function),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency — skip if already stored
  // -------------------------------------------------------------------------

  describe('Idempotency and per-step markers (F19)', () => {
    it('skips storeIncomingEmail when the message already exists', async () => {
      mockFindUnique.mockResolvedValueOnce({ id: 'msg_existing', dispatchedAt: null, enrichedAt: null });

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockStoreIncomingEmail).not.toHaveBeenCalled();
    });

    it('RE-DISPATCHES when an existing message has no dispatchedAt marker (the bug fix)', async () => {
      // Stored on a prior attempt that crashed before dispatch. Old code keyed
      // idempotency on message existence and skipped dispatch forever.
      mockFindUnique.mockResolvedValueOnce({ id: 'msg_existing', dispatchedAt: null, enrichedAt: null });

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockDispatchAutomationsForEmail).toHaveBeenCalledWith('msg_existing');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'msg_existing' },
        data: { dispatchedAt: expect.any(Date) },
      });
    });

    it('skips dispatch when dispatchedAt is already set', async () => {
      mockFindUnique.mockResolvedValueOnce({ id: 'msg_existing', dispatchedAt: new Date(), enrichedAt: null });

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockDispatchAutomationsForEmail).not.toHaveBeenCalled();
    });

    it('runs enrichment only when enrichedAt is unset, and marks it on success', async () => {
      mockFindUnique.mockResolvedValueOnce({ id: 'msg_existing', dispatchedAt: new Date(), enrichedAt: null });
      mockEnrichMessage.mockResolvedValueOnce(true);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockEnrichMessage).toHaveBeenCalledWith('msg_existing');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'msg_existing' },
        data: { enrichedAt: expect.any(Date) },
      });
    });

    it('does NOT set enrichedAt when enrichment fails transiently (returns false)', async () => {
      // enrichMessage never throws; a false result means a transient failure.
      // Marking enrichedAt anyway would permanently skip enrichment (the F19 bug).
      mockFindUnique.mockResolvedValueOnce({ id: 'msg_existing', dispatchedAt: new Date(), enrichedAt: null });
      mockEnrichMessage.mockResolvedValueOnce(false);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockEnrichMessage).toHaveBeenCalledWith('msg_existing');
      expect(mockUpdate).not.toHaveBeenCalledWith({
        where: { id: 'msg_existing' },
        data: { enrichedAt: expect.any(Date) },
      });
    });

    it('skips both steps when the message is already fully processed', async () => {
      mockFindUnique.mockResolvedValueOnce({ id: 'msg_existing', dispatchedAt: new Date(), enrichedAt: new Date() });

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockDispatchAutomationsForEmail).not.toHaveBeenCalled();
      expect(mockEnrichMessage).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('returns without throwing when the message already exists', async () => {
      mockFindUnique.mockResolvedValueOnce({ id: 'msg_existing', dispatchedAt: new Date(), enrichedAt: new Date() });

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await expect(capturedProcessor!(makeJob())).resolves.toBeUndefined();
    });

    it('newly stored message: dispatches, enriches, and sets both markers', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_new', dispatchedAt: null, enrichedAt: null }]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockDispatchAutomationsForEmail).toHaveBeenCalledWith('msg_new');
      expect(mockEnrichMessage).toHaveBeenCalledWith('msg_new');
      expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'msg_new' }, data: { dispatchedAt: expect.any(Date) } });
      expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'msg_new' }, data: { enrichedAt: expect.any(Date) } });
    });
  });

  // -------------------------------------------------------------------------
  // Empty store result — inbox removed / already deduplicated
  // -------------------------------------------------------------------------

  describe('Empty storeIncomingEmail result', () => {
    it('skips dispatchAutomationsForEmail when store returns empty array', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(mockDispatchAutomationsForEmail).not.toHaveBeenCalled();
    });

    it('returns without throwing when store returns empty array', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await expect(capturedProcessor!(makeJob())).resolves.toBeUndefined();
    });

    it('logs that 0 messages were returned', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce(new Error('DB write failed'));

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await expect(capturedProcessor!(makeJob({ attemptsMade: 0 }))).rejects.toThrow(
        'DB write failed',
      );
    });

    it('throws when dispatchAutomationsForEmail rejects', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockRejectedValueOnce('String error');

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await expect(
        capturedProcessor!(makeJob({ attemptsMade: 3, maxAttempts: 4 })),
      ).rejects.toBe('String error');
    });

    it('passes a malformed payload through without throwing before the store step', async () => {
      // findFirst returns null so we proceed to storeIncomingEmail
      mockFindUnique.mockResolvedValueOnce(null);
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
      mockFindUnique.mockResolvedValueOnce(null);
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
