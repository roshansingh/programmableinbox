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
import {
  WEBHOOK_QUEUE_NAME,
  WEBHOOK_QUEUE_CONFIG,
  EmailWebhookJobData,
  buildRedisOptions,
} from "./queue";
import {
  storeIncomingEmail,
  ResendEmailData,
} from "@/app/api/v1/webhooks/email/route";
import { dispatchAutomationsForEmail } from "@/lib/automations/dispatcher";
import { prisma } from "@/lib/db";

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
      console.error(
        `[webhook-worker] job ${job.id} failed (attempt ${job.attemptsMade}/${WEBHOOK_QUEUE_CONFIG.maxRetries + 1}):`,
        err.message,
      );
    }
  });

  _worker.on("completed", (job: Job<EmailWebhookJobData>) => {
    console.log(
      `[webhook-worker] job ${job.id} completed (externalId=${job.data.externalId})`,
    );
  });

  return _worker;
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

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
async function processEmailWebhookJob(
  job: Job<EmailWebhookJobData>,
): Promise<void> {
  const { externalId, inboxEmailAddressId, payload } = job.data;

  console.log(
    `[webhook-worker] processing job ${job.id}: externalId=${externalId} inbox=${inboxEmailAddressId} attempt=${job.attemptsMade + 1}`,
  );

  try {
    // ------------------------------------------------------------------
    // Step 1: Idempotency check
    // ------------------------------------------------------------------
    // `storeIncomingEmail` already handles P2002 duplicate errors, but we
    // short-circuit here to avoid the Resend API call and threading logic
    // when we can confirm upfront the message is already stored.
    const existingMessage = await prisma.emailMessage.findFirst({
      where: { externalId, inboxEmailAddressId },
      select: { id: true },
    });

    if (existingMessage) {
      console.log(
        `[webhook-worker] email ${externalId} already stored for inbox ${inboxEmailAddressId}, skipping`,
      );
      return;
    }

    // ------------------------------------------------------------------
    // Step 2: Store the email
    // ------------------------------------------------------------------
    // The payload was validated and shaped by the webhook route before being
    // enqueued, so casting to ResendEmailData is safe here.
    const resendEmail = payload as unknown as ResendEmailData;
    // Pass the inbox filter so storeIncomingEmail only writes to this specific
    // inbox. Without the filter, a fan-out email (to multiple inboxes) would
    // store messages in every matching inbox from every per-inbox job, causing
    // duplicate storage across jobs targeting the same email.
    const storedMessages = await storeIncomingEmail(resendEmail, [inboxEmailAddressId]);

    if (storedMessages.length === 0) {
      // No matching inboxes or all were duplicates — nothing left to do.
      console.log(
        `[webhook-worker] storeIncomingEmail returned 0 messages for ${externalId}; inbox may have been removed`,
      );
      return;
    }

    // ------------------------------------------------------------------
    // Step 3: Dispatch automations
    // ------------------------------------------------------------------
    // Run in parallel — automations for different messages are independent.
    await Promise.all(
      storedMessages.map((message) => dispatchAutomationsForEmail(message.id)),
    );

    console.log(
      `[webhook-worker] email ${externalId} fully processed: ${storedMessages.length} message(s) stored, automations dispatched`,
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    console.error(
      `[webhook-worker] job ${job.id} error on attempt ${job.attemptsMade + 1}:`,
      errorMessage,
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
      console.log(
        `[webhook-worker] writing dead-letter record for ${externalId} after ${job.attemptsMade + 1} attempt(s)`,
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
        console.error(
          `[webhook-worker] failed to write dead-letter record for ${externalId}:`,
          dlError,
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
  console.log("[webhook-worker] started");
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
    console.log("[webhook-worker] closed");
  }
}
