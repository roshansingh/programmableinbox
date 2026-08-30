/**
 * BullMQ Worker for async email webhook processing.
 *
 * Each job carries the full Resend email payload plus the target inbox ID.
 * The worker performs:
 *   1. Idempotency check — skip if `externalId` is already stored for this inbox.
 *   2. Email storage — `storeIncomingEmail` handles threading and deduplication,
 *      scoped to the specific inbox for this job.
 *   3. Automation dispatch — triggers any active automations for the stored message.
 *   4. Dead-letter — after all retries are exhausted, records the failure in the DB.
 *
 * WARNING: BullMQ open-source does not support job grouping / per-inbox ordering.
 * Jobs are processed concurrently up to the `concurrency` limit regardless of inbox.
 * To enforce per-inbox serial ordering, bullmq-pro or a custom worker strategy
 * would be required.
 */

import { Worker, Job } from "bullmq";
import { Redis } from "ioredis";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import {
  WEBHOOK_QUEUE_NAME,
  WEBHOOK_QUEUE_CONFIG,
  EmailWebhookJobData,
  buildRedisOptions,
} from "./queue";
import {
  storeIncomingEmail,
  ResendEmailData,
} from "@/app/api/webhooks/email/route";
import { dispatchAutomationsForEmail } from "@/lib/automations/dispatcher";
import { enrichMessage } from "@/lib/llm/enrichment";
import { prisma } from "@/lib/db";
import logger from "@/lib/logger";

const tracer = trace.getTracer("programmableinbox.webhooks");

// ---------------------------------------------------------------------------
// Worker singleton
// ---------------------------------------------------------------------------

let _worker: Worker<EmailWebhookJobData> | null = null;

/**
 * Returns the singleton BullMQ worker, creating it on first call.
 *
 * The worker uses its own dedicated ioredis connection. BullMQ workers run
 * blocking Redis commands (BRPOP / XREAD), so they must NOT share the Queue's
 * connection — doing so deadlocks the queue.
 *
 * @returns The running worker instance.
 */
export function getEmailWebhookWorker(): Worker<EmailWebhookJobData> {
  if (_worker) {
    return _worker;
  }

  // Each Worker needs its own connection; reusing the Queue's connection
  // would deadlock because blocking commands monopolise the TCP socket.
  const workerConnection = new Redis(buildRedisOptions());

  _worker = new Worker<EmailWebhookJobData>(
    WEBHOOK_QUEUE_NAME,
    processEmailWebhookJob,
    {
      connection: workerConnection,
      // Maximum number of jobs processed in parallel across all inboxes.
      // NOTE: BullMQ open-source has no per-inbox ordering — all jobs compete
      // for the same pool of concurrency slots.
      concurrency: WEBHOOK_QUEUE_CONFIG.concurrencyPerInbox,
    },
  );

  _worker.on("failed", (job: Job<EmailWebhookJobData> | undefined, err: Error) => {
    if (job) {
      logger.error(
        {
          jobId: job.id,
          attempt: job.attemptsMade,
          maxAttempts: WEBHOOK_QUEUE_CONFIG.maxRetries + 1,
          error: err,
        },
        "[webhook-worker] job failed",
      );
    }
  });

  _worker.on("completed", (job: Job<EmailWebhookJobData>) => {
    logger.info(
      { jobId: job.id, externalId: job.data.externalId },
      "[webhook-worker] job completed",
    );
  });

  return _worker;
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

/** A stored message with just the fields the per-step marker logic needs. */
type MessageMarkers = { id: string; dispatchedAt: Date | null; enrichedAt: Date | null };

/** Loads the already-stored message for this (externalId, inbox), if any. */
async function loadExistingMessage(
  externalId: string,
  inboxEmailAddressId: string,
): Promise<MessageMarkers[]> {
  // findUnique on the composite unique `(externalId, inboxEmailAddressId)`:
  // this lookup relies on that uniqueness, so it reads the unique index
  // directly and can't silently return an arbitrary row.
  const message = await prisma.emailMessage.findUnique({
    where: { externalId_inboxEmailAddressId: { externalId, inboxEmailAddressId } },
    select: { id: true, dispatchedAt: true, enrichedAt: true },
  });
  return message ? [message] : [];
}

async function processEmailWebhookJob(
  job: Job<EmailWebhookJobData>,
): Promise<void> {
  return tracer.startActiveSpan("webhook.process_email_job", async (span) => {
    span.setAttribute("programmableinbox.job_id", job.id ?? "");
    span.setAttribute("programmableinbox.external_id", job.data.externalId);
    span.setAttribute("programmableinbox.inbox_email_address_id", job.data.inboxEmailAddressId);
    try {
      await processEmailWebhookJobInner(job);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Processes a single email webhook job.
 *
 * Throws on failure so that BullMQ retries the job according to the attempt /
 * backoff settings set at enqueue time. After the final attempt, the error is
 * written to `EmailJobDeadLetter` before re-throwing so BullMQ can record the
 * terminal failure in its own store.
 *
 * @param job - BullMQ job containing the Resend email payload and inbox ID.
 */
async function processEmailWebhookJobInner(
  job: Job<EmailWebhookJobData>,
): Promise<void> {
  const { externalId, inboxEmailAddressId, payload } = job.data;

  logger.info(
    { jobId: job.id, externalId, inboxEmailAddressId, attempt: job.attemptsMade + 1 },
    "[webhook-worker] processing job",
  );

  try {
    // ------------------------------------------------------------------
    // Step 1: Resolve the message(s) — store if new, else load prior state
    // ------------------------------------------------------------------
    // Idempotency is tracked per processing step (dispatchedAt / enrichedAt),
    // NOT by message existence (F19). Keying off existence meant that a crash
    // after storage but before dispatch/enrichment caused the retry to see the
    // message, skip everything, and drop automations + enrichment permanently.
    let messages = await loadExistingMessage(externalId, inboxEmailAddressId);

    if (messages.length === 0) {
      // The payload was validated and shaped by the webhook route before being
      // enqueued, so casting to ResendEmailData is safe here. The inbox filter
      // keeps a fan-out email from being stored into every matching inbox by
      // every per-inbox job.
      const resendEmail = payload as unknown as ResendEmailData;
      const stored = await storeIncomingEmail(resendEmail, [inboxEmailAddressId]);

      if (stored.length > 0) {
        messages = stored.map((m) => ({
          id: m.id,
          dispatchedAt: m.dispatchedAt ?? null,
          enrichedAt: m.enrichedAt ?? null,
        }));
      } else {
        // storeIncomingEmail deduped (P2002) — a concurrent job may have stored
        // it. Re-load so this job still drives any unfinished step rather than
        // silently dropping it.
        messages = await loadExistingMessage(externalId, inboxEmailAddressId);
        if (messages.length === 0) {
          logger.info(
            { externalId },
            "[webhook-worker] storeIncomingEmail returned 0 messages; inbox may have been removed",
          );
          return;
        }
      }
    }

    // ------------------------------------------------------------------
    // Step 2: Dispatch automations — gated on the dispatchedAt marker
    // ------------------------------------------------------------------
    // Set the marker only after dispatch succeeds. A crash after dispatch but
    // before the marker write makes the retry re-dispatch (at-least-once). This
    // is a deliberate trade-off: it can re-run action side effects — the
    // auto-reply (de-duplicated by its atomic throttle, F17) but also
    // forward_email and send_webhook, which are NOT de-duplicated. Making those
    // exactly-once needs per-node/per-run idempotency keys, which is out of
    // scope here; at-least-once was the accepted behavior for this fix.
    await Promise.all(
      messages
        .filter((message) => !message.dispatchedAt)
        .map(async (message) => {
          await dispatchAutomationsForEmail(message.id);
          await prisma.emailMessage.update({
            where: { id: message.id },
            data: { dispatchedAt: new Date() },
          });
        }),
    );

    // ------------------------------------------------------------------
    // Step 3: LLM enrichment (best-effort, never throws) — gated on enrichedAt
    // ------------------------------------------------------------------
    await Promise.all(
      messages
        .filter((message) => !message.enrichedAt)
        .map(async (message) => {
          // enrichMessage is best-effort and never throws; it returns whether
          // the step is settled. Only mark enrichedAt when it is — a transient
          // enrichment failure must not permanently skip the step (F19).
          const settled = await enrichMessage(message.id);
          if (settled) {
            await prisma.emailMessage.update({
              where: { id: message.id },
              data: { enrichedAt: new Date() },
            });
          }
        }),
    );

    logger.info(
      { externalId, messageCount: messages.length },
      "[webhook-worker] email fully processed, automations dispatched",
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    logger.error(
      { jobId: job.id, attempt: job.attemptsMade + 1, error },
      "[webhook-worker] job error",
    );

    // ------------------------------------------------------------------
    // Dead-letter: only on the final attempt
    // ------------------------------------------------------------------
    // `job.attemptsMade` is the number of attempts *completed so far* — on the
    // last attempt it equals (maxRetries + 1) - 1 = maxRetries. Compare against
    // the total `attempts` the job was configured with (stored in job.opts).
    const maxAttempts = (job.opts.attempts ?? WEBHOOK_QUEUE_CONFIG.maxRetries + 1);
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

    if (isFinalAttempt) {
      logger.info(
        { externalId, attempts: job.attemptsMade + 1 },
        "[webhook-worker] writing dead-letter record",
      );

      try {
        // Use upsert so re-triggered dead-lettering (e.g. manual re-runs) is
        // idempotent — we update the error / attempt count rather than creating
        // a duplicate row.
        await prisma.emailJobDeadLetter.upsert({
          where: {
            externalId_inboxEmailAddressId: {
              externalId,
              inboxEmailAddressId,
            },
          },
          update: {
            error: errorMessage,
            attemptCount: job.attemptsMade + 1,
            updatedAt: new Date(),
          },
          create: {
            externalId,
            inboxEmailAddressId,
            payload: payload as object,
            error: errorMessage,
            attemptCount: job.attemptsMade + 1,
          },
        });
      } catch (dlError) {
        // Log but don't suppress the original error — the job must still fail
        // so BullMQ records a terminal state.
        logger.error(
          { externalId, error: dlError },
          "[webhook-worker] failed to write dead-letter record",
        );
      }
    }

    // Re-throw so BullMQ marks the job as failed and schedules the next retry
    // (or records a terminal failure if this was the last attempt).
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Initialises and starts the email webhook worker.
 *
 * Waits until the worker's Redis connection is ready before returning, so
 * callers can be confident that jobs will be picked up immediately after this
 * resolves.
 */
export async function startEmailWebhookWorker(): Promise<void> {
  const w = getEmailWebhookWorker();
  await w.waitUntilReady();
  logger.info("[webhook-worker] started");
}

/**
 * Gracefully shuts down the email webhook worker.
 *
 * Waits for any in-progress job to finish before closing the Redis connection.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function closeEmailWebhookWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
    logger.info("[webhook-worker] closed");
  }
}
