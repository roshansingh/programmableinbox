/**
 * Integration tests for the full async webhook processing pipeline.
 *
 * These tests exercise the POST /api/webhooks/email route end-to-end,
 * covering:
 *   - Async mode: one job enqueued per matching inbox, 200 response after enqueue
 *   - Sync mode: email stored and automations dispatched within the request
 *   - Idempotency: duplicate webhook events both enqueue (worker deduplicates)
 *   - No matching inboxes: 200 returned without enqueuing
 *   - Signature validation: invalid signatures rejected with 401
 *   - JSON parsing: malformed JSON rejected with 400
 *   - Timestamp validation: replayed/stale webhooks rejected with 401
 *   - Enqueue failures: return 500 to allow Resend retry (durable queueing)
 *
 * All external dependencies (Resend SDK, BullMQ queue, Prisma, automations
 * dispatcher) are mocked so no real network or database connections are needed.
 *
 * Module reset pattern: vi.resetModules() + dynamic import() is used to reset
 * singleton state between tests — the same pattern used in route.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Resend SDK mock
//
// The route calls `resend.emails.receiving.get(email_id)` after validating the
// webhook signature. We expose `getEmailMock` so each test can configure the
// returned email payload.
// ---------------------------------------------------------------------------

const getEmailMock = vi.fn();
const mockWebhooksVerify = vi.fn();

class MockResend {
  emails = {
    receiving: {
      get: getEmailMock,
    },
  };
  webhooks = {
    verify: mockWebhooksVerify,
  };
}

vi.mock('resend', () => ({
  Resend: MockResend,
}));

// ---------------------------------------------------------------------------
// Prisma mock
//
// emailInbox.findMany — controls which inboxes match the recipient addresses.
// emailMessage.create — used by storeIncomingEmail in the sync path.
// emailMessage.findFirst — threading (in-reply-to chain lookup).
// emailAttachment.createMany — attachment storage (no-op by default).
// ---------------------------------------------------------------------------

const inboxFindManyMock = vi.fn();
const messageCreateMock = vi.fn();
const messageFindFirstMock = vi.fn().mockResolvedValue(null); // no parent thread

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      findMany: (...args: unknown[]) => inboxFindManyMock(...args),
    },
    emailMessage: {
      create: (...args: unknown[]) => messageCreateMock(...args),
      findFirst: (...args: unknown[]) => messageFindFirstMock(...args),
    },
    emailAttachment: {
      createMany: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

// ---------------------------------------------------------------------------
// BullMQ queue mock — enqueueEmailWebhookJob
// ---------------------------------------------------------------------------

const enqueueEmailWebhookJobMock = vi.fn();

vi.mock('@/lib/webhooks/queue', () => ({
  enqueueEmailWebhookJob: (...args: unknown[]) =>
    enqueueEmailWebhookJobMock(...args),
  buildRedisOptions: () => ({}),
}));

vi.mock('@/lib/webhooks/worker', () => ({
  getEmailWebhookWorker: vi.fn(),
}));

// ---------------------------------------------------------------------------
// storeIncomingEmail runs within the same module as POST, so we cannot mock
// it via module interception without circular issues.  Instead, sync-mode
// tests control its behaviour by configuring the Prisma mocks it depends on
// (emailInbox.findMany + emailMessage.create).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Automations dispatcher mock
// ---------------------------------------------------------------------------

const dispatchAutomationsForEmailMock = vi.fn();

vi.mock('@/lib/automations/dispatcher', () => ({
  dispatchAutomationsForEmail: (...args: unknown[]) =>
    dispatchAutomationsForEmailMock(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = 'integration-test-secret';

/**
 * Builds a valid NextRequest-compatible Request for the webhook route.
 * The body is a WebhookEvent JSON string; headers use Svix format (mocked verification).
 */
function makeWebhookRequest(
  body: string,
  overrides: { timestamp?: string; } = {},
): Request {
  const timestamp =
    overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
  return new Request('http://localhost/api/webhooks/email', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'svix-id': 'msg_test_123',
      'svix-timestamp': timestamp,
      'svix-signature': 'v1,test-signature',
    },
  });
}

/**
 * Builds a standard email.received webhook event body for `emailId`.
 */
function emailReceivedBody(emailId: string): string {
  return JSON.stringify({ type: 'email.received', data: { email_id: emailId } });
}

/**
 * A representative Resend email payload returned by `resend.emails.receiving.get()`.
 */
function makeResendEmail(overrides: Record<string, unknown> = {}): object {
  return {
    from: 'sender@example.com',
    to: ['inbox@example.com'],
    cc: [],
    bcc: [],
    subject: 'Test Email',
    text: 'Hello world',
    html: '<p>Hello world</p>',
    headers: { 'message-id': '<test-msg@example.com>' },
    created_at: new Date().toISOString(),
    attachments: [],
    ...overrides,
  };
}

/** Dynamically imports the route after vi.resetModules() clears singleton state. */
async function loadRoute() {
  vi.resetModules();
  // Re-declare mocks in the fresh module graph after resetModules clears them.
  vi.mock('resend', () => ({ Resend: MockResend }));
  vi.mock('@/lib/db', () => ({
    prisma: {
      emailInbox: {
        findMany: (...args: unknown[]) => inboxFindManyMock(...args),
      },
      emailMessage: {
        create: (...args: unknown[]) => messageCreateMock(...args),
        findFirst: (...args: unknown[]) => messageFindFirstMock(...args),
      },
      emailAttachment: {
        createMany: vi.fn().mockResolvedValue(undefined),
      },
    },
  }));
  vi.mock('@/lib/webhooks/queue', () => ({
    enqueueEmailWebhookJob: (...args: unknown[]) =>
      enqueueEmailWebhookJobMock(...args),
  }));
  vi.mock('@/lib/automations/dispatcher', () => ({
    dispatchAutomationsForEmail: (...args: unknown[]) =>
      dispatchAutomationsForEmailMock(...args),
  }));
  return import('../route');
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Webhook Email Processing — Integration', () => {
  beforeEach(() => {
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING = 'true';
    mockWebhooksVerify.mockReturnValue(undefined); // default: passes verification
    enqueueEmailWebhookJobMock.mockResolvedValue(undefined);
    dispatchAutomationsForEmailMock.mockResolvedValue([]);
    getEmailMock.mockResolvedValue({ data: makeResendEmail() });
    inboxFindManyMock.mockResolvedValue([]);
    // Default: emailMessage.create succeeds with a stub message.
    messageCreateMock.mockResolvedValue({ id: 'msg_default', organizationId: 'org_1' });
    messageFindFirstMock.mockResolvedValue(null); // no existing thread parent
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.WEBHOOK_SECRET;
    delete process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING;
  });

  // -------------------------------------------------------------------------
  // Signature validation
  // -------------------------------------------------------------------------

  describe('Signature validation', () => {
    it('returns 401 when signature headers are absent', async () => {
      const { POST } = await loadRoute();
      // Mock verify to throw when headers are missing
      mockWebhooksVerify.mockImplementationOnce(() => {
        throw new Error('Missing headers');
      });
      const request = new Request('http://localhost/api/webhooks/email', {
        method: 'POST',
        body: emailReceivedBody('em_nosig'),
        headers: { 'content-type': 'application/json' },
      });

      const response = await POST(request as any);

      expect(response.status).toBe(401);
      expect(enqueueEmailWebhookJobMock).not.toHaveBeenCalled();
    });

    it('returns 401 when svix-signature is present but svix-timestamp is absent', async () => {
      const { POST } = await loadRoute();
      // Mock verify to throw when timestamp is missing
      mockWebhooksVerify.mockImplementationOnce(() => {
        throw new Error('Missing timestamp');
      });
      const body = emailReceivedBody('em_notimestamp');
      const request = new Request('http://localhost/api/webhooks/email', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'svix-id': 'msg_notimestamp',
          'svix-signature': 'v1,abc123',
        },
      });

      const response = await POST(request as any);

      expect(response.status).toBe(401);
      expect(enqueueEmailWebhookJobMock).not.toHaveBeenCalled();
    });

    it('returns 401 for a tampered signature', async () => {
      const { POST } = await loadRoute();
      // Mock verify to throw for tampered signature
      mockWebhooksVerify.mockImplementationOnce(() => {
        throw new Error('Signature verification failed');
      });
      const body = emailReceivedBody('em_tampered');
      const timestamp = String(Math.floor(Date.now() / 1000));
      const request = new Request('http://localhost/api/webhooks/email', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'svix-id': 'msg_tampered',
          'svix-timestamp': timestamp,
          'svix-signature': 'v1,deadbeef', // wrong signature
        },
      });

      const response = await POST(request as any);

      expect(response.status).toBe(401);
      expect(enqueueEmailWebhookJobMock).not.toHaveBeenCalled();
    });

    it('returns 401 for a signature produced with a different secret', async () => {
      const { POST } = await loadRoute();
      // Mock verify to throw when signature doesn't match
      mockWebhooksVerify.mockImplementationOnce(() => {
        throw new Error('Invalid signature');
      });
      const body = emailReceivedBody('em_wrongsecret');
      const timestamp = String(Math.floor(Date.now() / 1000));

      const request = new Request('http://localhost/api/webhooks/email', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'svix-id': 'msg_wrong',
          'svix-timestamp': timestamp,
          'svix-signature': 'v1,invalid',
        },
      });

      const response = await POST(request as any);

      expect(response.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // JSON parsing
  // -------------------------------------------------------------------------

  describe('JSON parsing', () => {
    it('returns 400 when the request body is not valid JSON', async () => {
      const { POST } = await loadRoute();
      const timestamp = String(Math.floor(Date.now() / 1000));
      const invalidJson = 'not valid json {]';

      const request = new Request('http://localhost/api/webhooks/email', {
        method: 'POST',
        body: invalidJson,
        headers: {
          'content-type': 'application/json',
          'svix-id': 'msg_json',
          'svix-timestamp': timestamp,
          'svix-signature': 'v1,test-signature',
        },
      });

      const response = await POST(request as any);

      expect(response.status).toBe(400);
      expect(enqueueEmailWebhookJobMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Timestamp / replay-attack validation
  // -------------------------------------------------------------------------

  describe('Timestamp validation', () => {
    it('returns 401 for a timestamp older than 5 minutes (replay attack window)', async () => {
      const { POST } = await loadRoute();
      // 6 minutes in the past — outside the 300-second replay window.
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 360);
      const body = emailReceivedBody('em_stale');
      // Mock verify to throw for stale timestamps
      mockWebhooksVerify.mockImplementationOnce(() => {
        throw new Error('Timestamp outside window');
      });
      const request = makeWebhookRequest(body, { timestamp: staleTimestamp });

      const response = await POST(request as any);

      expect(response.status).toBe(401);
      expect(enqueueEmailWebhookJobMock).not.toHaveBeenCalled();
    });

    it('accepts a timestamp that is within the 5-minute replay window', async () => {
      const { POST } = await loadRoute();
      // 4 minutes in the past — still inside the 300-second window.
      const recentTimestamp = String(Math.floor(Date.now() / 1000) - 240);
      const body = emailReceivedBody('em_recent');
      inboxFindManyMock.mockResolvedValueOnce([]);
      getEmailMock.mockResolvedValueOnce({ data: makeResendEmail() });

      const request = makeWebhookRequest(body, { timestamp: recentTimestamp });

      const response = await POST(request as any);

      // Route proceeds (no 401) — no inboxes means a fast 200 with no enqueue.
      expect(response.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // No matching inboxes
  // -------------------------------------------------------------------------

  describe('No matching inboxes', () => {
    it('returns 200 and does not enqueue when no inboxes match the recipient addresses', async () => {
      const { POST } = await loadRoute();
      inboxFindManyMock.mockResolvedValueOnce([]);
      getEmailMock.mockResolvedValueOnce({ data: makeResendEmail() });

      const body = emailReceivedBody('em_noinbox');
      const response = await POST(makeWebhookRequest(body) as any);

      expect(response.status).toBe(200);
      expect(enqueueEmailWebhookJobMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Async mode (ENABLE_ASYNC_WEBHOOK_PROCESSING=true)
  // -------------------------------------------------------------------------

  describe('Async mode (ENABLE_ASYNC_WEBHOOK_PROCESSING=true)', () => {
    it('enqueues one job per matching inbox and returns 200', async () => {
      const { POST } = await loadRoute();
      inboxFindManyMock.mockResolvedValueOnce([
        { id: 'inbox_1', email: 'inbox@example.com', organizationId: 'org_1' },
        { id: 'inbox_2', email: 'inbox@example.com', organizationId: 'org_2' },
      ]);
      getEmailMock.mockResolvedValueOnce({
        data: makeResendEmail({ to: ['inbox@example.com'] }),
      });

      const body = emailReceivedBody('em_async_multi');
      const response = await POST(makeWebhookRequest(body) as any);
      const responseBody = await response.json();

      expect(response.status).toBe(200);
      expect(responseBody.message).toContain('queued');
      expect(enqueueEmailWebhookJobMock).toHaveBeenCalledTimes(2);
    });

    it('enqueues jobs carrying the externalId, inboxEmailAddressId, and payload', async () => {
      const { POST } = await loadRoute();
      const emailData = makeResendEmail({ to: ['inbox@example.com'] });
      inboxFindManyMock.mockResolvedValueOnce([
        { id: 'inbox_abc', email: 'inbox@example.com', organizationId: 'org_x' },
      ]);
      getEmailMock.mockResolvedValueOnce({ data: emailData });

      const body = emailReceivedBody('em_payload_check');
      await POST(makeWebhookRequest(body) as any);

      expect(enqueueEmailWebhookJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: 'em_payload_check',
          inboxEmailAddressId: 'inbox_abc',
          payload: expect.objectContaining({
            from: 'sender@example.com',
            subject: 'Test Email',
          }),
        }),
      );
    });

    it('waits for all enqueue operations to complete before returning 200', async () => {
      const { POST } = await loadRoute();
      inboxFindManyMock.mockResolvedValueOnce([
        { id: 'inbox_slow', email: 'inbox@example.com', organizationId: 'org_1' },
      ]);
      getEmailMock.mockResolvedValueOnce({
        data: makeResendEmail({ to: ['inbox@example.com'] }),
      });
      // Make enqueue artificially slow (50 ms).
      enqueueEmailWebhookJobMock.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 50)),
      );

      const body = emailReceivedBody('em_await_enqueue');
      const start = Date.now();
      const response = await POST(makeWebhookRequest(body) as any);
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      // The route must wait for enqueue to complete (at least 50 ms).
      expect(elapsed).toBeGreaterThanOrEqual(50);
    });

    it('returns 500 when enqueue throws (lets Resend retry)', async () => {
      const { POST } = await loadRoute();
      inboxFindManyMock.mockResolvedValueOnce([
        { id: 'inbox_fail', email: 'inbox@example.com', organizationId: 'org_1' },
      ]);
      getEmailMock.mockResolvedValueOnce({
        data: makeResendEmail({ to: ['inbox@example.com'] }),
      });
      enqueueEmailWebhookJobMock.mockRejectedValueOnce(
        new Error('Redis unavailable'),
      );

      const body = emailReceivedBody('em_enqueue_fail');
      const response = await POST(makeWebhookRequest(body) as any);

      // Enqueue failure is fatal in async mode — return 500 so Resend retries.
      expect(response.status).toBe(500);
    });

    it('does not call storeIncomingEmail in async mode', async () => {
      const { POST } = await loadRoute();
      inboxFindManyMock.mockResolvedValueOnce([
        { id: 'inbox_1', email: 'inbox@example.com', organizationId: 'org_1' },
      ]);
      getEmailMock.mockResolvedValueOnce({
        data: makeResendEmail({ to: ['inbox@example.com'] }),
      });

      const body = emailReceivedBody('em_no_sync_store');
      await POST(makeWebhookRequest(body) as any);

      // storeIncomingEmail uses prisma internally — we confirm it did NOT run
      // by checking that messageCreateMock was never called.
      expect(messageCreateMock).not.toHaveBeenCalled();
    });

    it('does not call dispatchAutomationsForEmail in async mode', async () => {
      const { POST } = await loadRoute();
      inboxFindManyMock.mockResolvedValueOnce([
        { id: 'inbox_1', email: 'inbox@example.com', organizationId: 'org_1' },
      ]);
      getEmailMock.mockResolvedValueOnce({
        data: makeResendEmail({ to: ['inbox@example.com'] }),
      });

      const body = emailReceivedBody('em_no_sync_dispatch');
      await POST(makeWebhookRequest(body) as any);

      expect(dispatchAutomationsForEmailMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Sync mode (ENABLE_ASYNC_WEBHOOK_PROCESSING=false)
  // -------------------------------------------------------------------------

  describe('Sync mode (ENABLE_ASYNC_WEBHOOK_PROCESSING=false)', () => {
    beforeEach(() => {
      process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING = 'false';
    });

    it('stores the email synchronously and does not enqueue', async () => {
      // The sync path makes TWO prisma.emailInbox.findMany calls:
      //   1. The route-level lookup (line ~313 in route.ts): finds matching inboxes
      //      by recipient address to decide how many jobs to create / how many
      //      storeIncomingEmail calls to make.
      //   2. The storeIncomingEmail-internal lookup (line ~187): re-queries by ID
      //      so it can verify the inbox still exists and get its organizationId.
      //
      // Both calls need to return the same inbox for the message to be stored.
      const { POST } = await loadRoute();
      const inbox = { id: 'inbox_sync', email: 'inbox@example.com', organizationId: 'org_1' };
      // First call: route-level lookup by email address.
      inboxFindManyMock.mockResolvedValueOnce([inbox]);
      // Second call: storeIncomingEmail internal lookup by ID.
      inboxFindManyMock.mockResolvedValueOnce([inbox]);
      getEmailMock.mockResolvedValueOnce({
        data: makeResendEmail({ to: ['inbox@example.com'] }),
      });
      messageCreateMock.mockResolvedValueOnce({ id: 'msg_sync_1', organizationId: 'org_1' });
      dispatchAutomationsForEmailMock.mockResolvedValue([]);

      const body = emailReceivedBody('em_sync');
      const response = await POST(makeWebhookRequest(body) as any);

      expect(response.status).toBe(200);
      expect(enqueueEmailWebhookJobMock).not.toHaveBeenCalled();
      // Sync path: storeIncomingEmail ran and wrote to the DB.
      expect(messageCreateMock).toHaveBeenCalledTimes(1);
    });

    it('dispatches automations for each stored message in sync mode', async () => {
      // Two inboxes each receive the email.  The route calls storeIncomingEmail
      // once per inbox, each of which makes its own emailInbox.findMany call.
      // Total findMany calls: 1 (route) + 2 (storeIncomingEmail × 2) = 3.
      const { POST } = await loadRoute();
      const inboxA = { id: 'inbox_sync_a', email: 'a@example.com', organizationId: 'org_1' };
      const inboxB = { id: 'inbox_sync_b', email: 'b@example.com', organizationId: 'org_2' };
      // Call 1: route-level lookup.
      inboxFindManyMock.mockResolvedValueOnce([inboxA, inboxB]);
      // Calls 2 & 3: one per storeIncomingEmail invocation.
      inboxFindManyMock.mockResolvedValueOnce([inboxA]);
      inboxFindManyMock.mockResolvedValueOnce([inboxB]);
      getEmailMock.mockResolvedValueOnce({
        data: makeResendEmail({ to: ['a@example.com', 'b@example.com'] }),
      });
      messageCreateMock
        .mockResolvedValueOnce({ id: 'msg_a', organizationId: 'org_1' })
        .mockResolvedValueOnce({ id: 'msg_b', organizationId: 'org_2' });
      dispatchAutomationsForEmailMock.mockResolvedValue([]);

      const body = emailReceivedBody('em_sync_dispatch');
      await POST(makeWebhookRequest(body) as any);

      expect(dispatchAutomationsForEmailMock).toHaveBeenCalledTimes(2);
      expect(dispatchAutomationsForEmailMock).toHaveBeenCalledWith('msg_a');
      expect(dispatchAutomationsForEmailMock).toHaveBeenCalledWith('msg_b');
    });

    it('returns 500 and does not enqueue when sync processing throws', async () => {
      // If dispatchAutomationsForEmail throws, the route's outer try/catch
      // catches it and returns 500.  storeIncomingEmail itself silently swallows
      // per-inbox errors (only P2002 duplicates skip, all others log-and-continue),
      // so we trigger the failure at the dispatch step instead.
      const { POST } = await loadRoute();
      const inbox = { id: 'inbox_sync', email: 'inbox@example.com', organizationId: 'org_1' };
      // Route-level lookup.
      inboxFindManyMock.mockResolvedValueOnce([inbox]);
      // storeIncomingEmail internal lookup.
      inboxFindManyMock.mockResolvedValueOnce([inbox]);
      getEmailMock.mockResolvedValueOnce({
        data: makeResendEmail({ to: ['inbox@example.com'] }),
      });
      messageCreateMock.mockResolvedValueOnce({ id: 'msg_fail', organizationId: 'org_1' });
      dispatchAutomationsForEmailMock.mockRejectedValueOnce(
        new Error('Automation engine unavailable'),
      );

      const body = emailReceivedBody('em_sync_fail');
      const response = await POST(makeWebhookRequest(body) as any);

      expect(response.status).toBe(500);
      expect(enqueueEmailWebhookJobMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency — duplicate webhook events
  // -------------------------------------------------------------------------

  describe('Idempotency — duplicate webhook events', () => {
    it('enqueues on both the original and duplicate webhook (worker deduplicates)', async () => {
      // The route is stateless with respect to deduplication — it always enqueues.
      // Deduplication is the worker's responsibility (idempotency check in worker.ts).
      const emailId = 'em_dupe';
      inboxFindManyMock.mockResolvedValue([
        { id: 'inbox_1', email: 'inbox@example.com', organizationId: 'org_1' },
      ]);
      getEmailMock.mockResolvedValue({
        data: makeResendEmail({ to: ['inbox@example.com'] }),
      });

      const body = emailReceivedBody(emailId);

      const { POST } = await loadRoute();

      // First delivery.
      const r1 = await POST(makeWebhookRequest(body) as any);
      // Second delivery of the same event (simulates Resend at-least-once delivery).
      const r2 = await POST(makeWebhookRequest(body) as any);

      // Allow fire-and-forget Promises to settle.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      // Both deliveries enqueue — deduplication happens in the worker.
      expect(enqueueEmailWebhookJobMock).toHaveBeenCalledTimes(2);
      expect(enqueueEmailWebhookJobMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ externalId: emailId }),
      );
      expect(enqueueEmailWebhookJobMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ externalId: emailId }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Non-email events (e.g. email.opened)
  // -------------------------------------------------------------------------

  describe('Non-email.received events', () => {
    it('returns 200 without enqueuing for non email.received events', async () => {
      const { POST } = await loadRoute();
      const body = JSON.stringify({
        type: 'email.opened',
        data: { email_id: 'em_opened' },
      });
      const response = await POST(makeWebhookRequest(body) as any);

      expect(response.status).toBe(200);
      expect(enqueueEmailWebhookJobMock).not.toHaveBeenCalled();
      // Resend SDK should not be called for unrecognised event types.
      expect(getEmailMock).not.toHaveBeenCalled();
    });

    it('returns 200 without enqueuing when email_id is missing from the event data', async () => {
      const { POST } = await loadRoute();
      const body = JSON.stringify({
        type: 'email.received',
        data: {}, // no email_id
      });
      const response = await POST(makeWebhookRequest(body) as any);

      expect(response.status).toBe(200);
      expect(enqueueEmailWebhookJobMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Dead-letter on worker failure after retries (tested via worker.ts unit tests)
  //
  // Dead-lettering is handled inside the BullMQ worker (lib/webhooks/worker.ts),
  // not the webhook route. Full dead-letter coverage lives in
  // lib/webhooks/__tests__/worker.test.ts. We include a smoke-test here to
  // confirm the route correctly passes the raw payload so the worker can write
  // a dead-letter record if needed.
  // -------------------------------------------------------------------------

  describe('Dead-letter smoke test — payload fidelity', () => {
    it('enqueues the full Resend email payload so the worker can dead-letter it on failure', async () => {
      const { POST } = await loadRoute();
      const emailData = makeResendEmail({
        to: ['inbox@example.com'],
        subject: 'Dead-letter test',
        text: 'Important content',
      });
      inboxFindManyMock.mockResolvedValueOnce([
        { id: 'inbox_dl', email: 'inbox@example.com', organizationId: 'org_dl' },
      ]);
      getEmailMock.mockResolvedValueOnce({ data: emailData });

      const body = emailReceivedBody('em_dl_payload');
      await POST(makeWebhookRequest(body) as any);

      // Allow fire-and-forget to settle.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The job payload must be the full Resend email so the worker can
      // persist it in EmailJobDeadLetter if all retries are exhausted.
      expect(enqueueEmailWebhookJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: 'em_dl_payload',
          payload: expect.objectContaining({
            subject: 'Dead-letter test',
            text: 'Important content',
          }),
        }),
      );
    });
  });
});
