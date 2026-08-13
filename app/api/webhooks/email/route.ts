import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { enqueueEmailWebhookJob } from '@/lib/webhooks/queue'
import { dispatchAutomationsForEmail } from '@/lib/automations/dispatcher'
import { getEmailWebhookWorker } from '@/lib/webhooks/worker'
import { enrichMessage } from '@/lib/llm/enrichment'
import { getResend } from '@/lib/resend'
import { deriveBodyText } from '@/lib/email/extract-body-text'
import { isUniqueViolation } from '@/lib/api-helpers'
import { CommercialProvider } from '@/lib/commercial/provider'
import { withPublic } from '@/lib/auth/with-auth'
import { config } from '@/lib/config'
import logger from '@/lib/logger'

/**
 * Returns true when async (BullMQ) webhook processing is enabled.
 * When disabled, the webhook route falls back to synchronous in-request processing.
 * Controlled by the ENABLE_ASYNC_WEBHOOK_PROCESSING environment variable.
 */
function isAsyncWebhookProcessingEnabled(): boolean {
  return config.webhooks.asyncProcessingEnabled
}

interface WebhookEvent {
  type: string
  data: {
    email_id?: string
    [key: string]: unknown
  }
}

export interface ResendEmailData {
  id: string
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text?: string
  html?: string
  headers: Record<string, string>
  created_at: string
  message_id?: string
  attachments?: Array<{
    filename?: string
    content_type?: string
    size?: number
  }>
}

/**
 * Get a header value by name, case-insensitive.
 * Email headers are case-insensitive per RFC 2822.
 */
function getHeader(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null
  const lowerName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value
  }
  return null
}

/**
 * Strip Re:/Fwd:/Fw: prefixes from a subject line to get the base subject.
 */
function normalizeSubject(subject: string): string {
  return subject.replace(/^(Re|Fwd|Fw):\s*/gi, '').trim()
}

async function determineThreading(email: ResendEmailData, dbId: string, inboxId: string) {
  // Use the top-level message_id from Resend, or the Message-ID header, or generate a fallback
  const emailMessageId = email.message_id
    || getHeader(email.headers, 'message-id')
    || `<${email.id}@inboxui.generated>`
  const storedMessageId = `${emailMessageId}::${inboxId}`
  const inReplyTo = getHeader(email.headers, 'in-reply-to')
  const referencesHeader = getHeader(email.headers, 'references') || ''
  const references = referencesHeader
    ? referencesHeader.split(/\s+/).filter(Boolean)
    : []

  // 1. Try matching by In-Reply-To / References headers
  if (inReplyTo || references.length > 0) {
    const candidates = [inReplyTo, ...references].filter(Boolean) as string[]

    for (const candidate of candidates) {
      const parentMessage = await prisma.emailMessage.findFirst({
        where: {
          inboxEmailAddressId: inboxId,
          messageId: {
            startsWith: `${candidate}::`,
          },
        },
        select: { id: true, threadId: true },
      })

      if (parentMessage) {
        return {
          threadId: parentMessage.threadId,
          parentMessageId: parentMessage.id,
          messageId: storedMessageId,
          inReplyTo,
          references,
        }
      }
    }
  }

  // 2. Fallback: match by subject within the same inbox.
  //    This catches replies where the In-Reply-To references a Message-ID we don't have
  //    (e.g. Resend assigns its own Message-ID to outgoing emails).
  const baseSubject = normalizeSubject(email.subject)
  if (baseSubject && baseSubject !== email.subject) {
    // Subject had a Re:/Fwd: prefix, so this is likely a reply
    const existingMessage = await prisma.emailMessage.findFirst({
      where: {
        inboxEmailAddressId: inboxId,
        subject: baseSubject,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, threadId: true },
    })

    if (existingMessage) {
      return {
        threadId: existingMessage.threadId,
        parentMessageId: existingMessage.id,
        messageId: storedMessageId,
        inReplyTo,
        references,
      }
    }
  }

  return {
    threadId: dbId,
    parentMessageId: null,
    messageId: storedMessageId,
    inReplyTo: null,
    references: [] as string[],
  }
}

export async function storeIncomingEmail(resendEmail: ResendEmailData, inboxEmailAddressIds?: string[]) {
  const receivedAt = new Date(resendEmail.created_at)
  if (Number.isNaN(receivedAt.getTime())) {
    throw new Error(`Invalid Resend created_at timestamp for email ${resendEmail.id}`)
  }

  const allAddresses = [
    ...resendEmail.to,
    ...(resendEmail.cc || []),
    ...(resendEmail.bcc || []),
  ].map((e) => e.toLowerCase().trim())

  let matchingInboxes: Awaited<ReturnType<typeof prisma.emailInbox.findMany>>

  if (inboxEmailAddressIds && inboxEmailAddressIds.length > 0) {
    // When called from the async worker, use the inbox IDs directly.
    // The webhook route already validated these inboxes exist and match the email.
    // Don't re-filter by email address: the inbox may have matched for reasons
    // other than direct recipient (e.g., BCC'd or forwarded from another address).
    matchingInboxes = await prisma.emailInbox.findMany({
      where: {
        id: { in: inboxEmailAddressIds },
      },
    })
  } else {
    // Default path (direct webhook route): match all inboxes that appear in
    // the recipient list.
    matchingInboxes = await prisma.emailInbox.findMany({
      where: { email: { in: allAddresses } },
    })
  }

  // Defensive guard for callers of storeIncomingEmail directly; the POST handler
  // has its own early-exit check (~line 311) that prevents reaching here in the
  // normal webhook path, so these two log sites are mutually exclusive.
  if (matchingInboxes.length === 0) {
    logger.info({ emailId: resendEmail.id, addresses: allAddresses }, 'No matching inboxes for email')
    return []
  }

  const created = []

  for (const inbox of matchingInboxes) {
    // Plan quota (issue #117 §6a). Metered here, not in the route, because this
    // is where the sync path and the async worker converge — a check in the
    // route is one the worker silently skips.
    //
    // Per inbox, and therefore per organization: fan-out crosses tenants, so a
    // single shared check would let one organization's exhausted allowance drop
    // another's mail.
    //
    // Consumed *before* the insert. Consuming after leaves a window where
    // concurrent deliveries both observe the same usage and both proceed; the
    // statement behind `consume` is atomic precisely so this ordering is safe.
    //
    // Resolved once per inbox and threaded through every quota call below.
    // Without it `consume` resolves, and then `increment`/`refund` resolve
    // again — two or three lookups per delivered message.
    const plan = await CommercialProvider.plans.resolve(inbox.organizationId)
    const quota = await CommercialProvider.quota.consume(
      inbox.organizationId,
      'emails.processed',
      1,
      plan,
    )

    if (!quota.allowed) {
      // Dropped, not stored-and-flagged: nothing is persisted and the message
      // cannot be recovered by upgrading. `emails.dropped` is what lets the
      // dashboard say how much was lost rather than only that the cap was hit.
      await CommercialProvider.quota.increment(inbox.organizationId, 'emails.dropped', 1, plan)
      logger.warn(
        {
          inboxEmail: inbox.email,
          organizationId: inbox.organizationId,
          externalId: resendEmail.id,
          limit: quota.limit,
          used: quota.used,
        },
        'Incoming email dropped: organization is over its plan quota',
      )
      continue
    }

    let message
    try {
      const messageId = crypto.randomUUID()
      const threading = await determineThreading(resendEmail, messageId, inbox.id)

      message = await prisma.emailMessage.create({
        data: {
          id: messageId,
          from: resendEmail.from,
          to: resendEmail.to,
          cc: resendEmail.cc || [],
          bcc: resendEmail.bcc || [],
          subject: resendEmail.subject,
          text: resendEmail.text || '',
          html: resendEmail.html || '',
          // Derived here rather than during enrichment (issue #106): enrichment is
          // LLM-gated and optional, so deriving it there would mean a message is
          // unsearchable until an optional step happens to run.
          bodyText: deriveBodyText({
            text: resendEmail.text || '',
            html: resendEmail.html || '',
          }),
          headers: resendEmail.headers || {},
          externalId: resendEmail.id,
          inboxEmailAddressId: inbox.id,
          organizationId: inbox.organizationId,
          threadId: threading.threadId,
          parentMessageId: threading.parentMessageId,
          messageId: threading.messageId,
          inReplyTo: threading.inReplyTo,
          references: threading.references,
          createdAt: receivedAt,
        },
      })
    } catch (error: any) {
      // Skip duplicates. A retried delivery of the same email deterministically
      // reproduces both the (externalId, inboxEmailAddressId) unique key and the
      // derived messageId, and Postgres only reports whichever constraint it
      // checks first — so both must be treated as "already stored", not a failure.
      const isDuplicateKeyViolation =
        isUniqueViolation(error, 'externalId') || isUniqueViolation(error, 'messageId')

      if (isDuplicateKeyViolation) {
        // Give the unit back. Resend retries deliveries, and every retry would
        // otherwise burn another unit of an allowance the organization never
        // actually spent — the message was already stored the first time.
        await CommercialProvider.quota.refund(inbox.organizationId, 'emails.processed', 1, plan)
        logger.info({ inboxEmail: inbox.email, externalId: resendEmail.id }, 'Duplicate email skipped for inbox')
        continue
      }
      // Not a duplicate, so nothing was stored and the unit is refunded too.
      // Failing to do so would charge an organization for our own fault, and
      // Resend's retry of the same message would charge again.
      await CommercialProvider.quota.refund(inbox.organizationId, 'emails.processed', 1, plan)
      logger.error({ error, inboxEmail: inbox.email }, 'Failed to store email for inbox')
      continue
    }

    if (resendEmail.attachments?.length) {
      try {
        await prisma.emailAttachment.createMany({
          data: resendEmail.attachments.map((attachment) => ({
            emailMessageId: message.id,
            filename: attachment.filename || 'attachment',
            contentType: attachment.content_type || null,
            sizeBytes: attachment.size || null,
          })),
        })
      } catch (error) {
        // The message row is already committed at this point, so the
        // organization has genuinely received it — no refund. Log and move on
        // rather than losing the message over an attachment-only failure.
        logger.error({ error, inboxEmail: inbox.email, messageId: message.id }, 'Failed to store attachments for email message')
      }
    }

    created.push(message)
  }

  return created
}

/**
 * Unauthenticated by design: Resend has no bearer credential to present. The
 * handler authenticates the *request* instead, via the Svix HMAC check below.
 * withPublic carries no behavior — it marks the intent so the structural guards
 * can tell "deliberately open" apart from "someone forgot the wrapper".
 */
export const POST = withPublic(async (request: NextRequest) => {
  const rawBody = await request.text()

  // Verify webhook signature using Resend's Svix-based verification (includes replay attack prevention)
  try {
    getResend().webhooks.verify({
      payload: rawBody,
      headers: {
        id: request.headers.get('svix-id')!,
        timestamp: request.headers.get('svix-timestamp')!,
        signature: request.headers.get('svix-signature')!,
      },
      // No `!` needed: config.webhooks.secret is a validated non-empty
      // string. The assertion here used to let an unset WEBHOOK_SECRET reach
      // signature verification as undefined.
      webhookSecret: config.webhooks.secret.reveal(),
    });
  } catch (error) {
    logger.warn({
      error,
      svixId: request.headers.get('svix-id'),
      svixTimestamp: request.headers.get('svix-timestamp'),
    }, 'Invalid webhook signature')
    return NextResponse.json({ message: 'Invalid webhook signature' }, { status: 401 })
  }

  // Start worker if async processing is enabled (ensures it's running before jobs arrive)
  if (isAsyncWebhookProcessingEnabled()) {
    try {
      getEmailWebhookWorker();
    } catch (error) {
      logger.error({ error }, 'Failed to initialize webhook worker')
    }
  }

  let event: WebhookEvent
  try {
    event = JSON.parse(rawBody)
  } catch (error) {
    logger.error({ error }, 'Failed to parse webhook payload as JSON')
    return NextResponse.json({ message: 'Invalid JSON payload' }, { status: 400 })
  }

  // Only process email.received events
  if (event.type !== 'email.received' || !event.data.email_id) {
    return NextResponse.json({ message: 'Webhook received' })
  }

  try {
    // Fetch full email data from Resend (webhook only contains the email ID)
    const { data: email, error: fetchError } = await getResend().emails.receiving.get(event.data.email_id)

    if (!email) {
      // `error` carries the actual reason (not_found, restricted_api_key,
      // invalid_access, rate_limit_exceeded, ...) — surfacing it is the only
      // way to tell a genuine missing email apart from an API-key/permission
      // problem that will fail on every event, not just this one.
      logger.warn({ emailId: event.data.email_id, error: fetchError }, 'Email not found for ID')
      return NextResponse.json({ message: 'Webhook received' })
    }

    // Construct email data object from Resend API response
    if (!email.created_at) {
      throw new Error(`Resend email ${event.data.email_id} is missing created_at`)
    }

    const resendEmail: ResendEmailData = {
      id: event.data.email_id,
      from: email.from,
      to: email.to || [],
      cc: email.cc || [],
      bcc: email.bcc || [],
      subject: email.subject || '',
      text: email.text || '',
      html: email.html || '',
      headers: email.headers || {},
      created_at: email.created_at,
      message_id: (email as any).message_id,
      attachments: Array.isArray((email as any).attachments)
        ? (email as any).attachments
        : [],
    }

    // Fan-out: find all inboxes that should receive this email (recipients include To, Cc, Bcc)
    //
    // The lowercase+trim here is half of a contract with the claiming routes:
    // stored addresses are normalized the same way (`lib/email-address.ts`,
    // enforced by a CHECK constraint), so this exact-match `in` is a complete
    // case-insensitive match. Fan-out is what makes that load-bearing — every
    // row matching here gets a full copy of the email, so two rows for one
    // address is cross-tenant disclosure (F1 / issue #37). Do not relax the
    // normalization on either side independently.
    const allAddresses = [
      ...resendEmail.to,
      ...(resendEmail.cc || []),
      ...(resendEmail.bcc || []),
    ].map((e) => e.toLowerCase().trim())

    const matchingInboxes = await prisma.emailInbox.findMany({
      where: { email: { in: allAddresses } },
    })

    // Early exit before calling storeIncomingEmail; a parallel guard inside that
    // function (~line 169) handles the same condition for direct callers — the
    // two log sites are mutually exclusive in the normal webhook code path.
    if (matchingInboxes.length === 0) {
      logger.info({ emailId: event.data.email_id, addresses: allAddresses }, 'No matching inboxes for email')
      return NextResponse.json({ message: 'Webhook received' })
    }

    if (isAsyncWebhookProcessingEnabled()) {
      // ASYNC PATH: Enqueue one job per matching inbox, return immediately (50-100ms)
      // Worker processes jobs in background, storing emails and dispatching automations.
      // Await all enqueue operations to ensure durability: return 500 if any fail.
      // This guarantees that if we return 200, all jobs are in Redis and will be processed.
      await Promise.all(
        matchingInboxes.map((inbox) =>
          enqueueEmailWebhookJob({
            externalId: resendEmail.id,
            inboxEmailAddressId: inbox.id,
            payload: resendEmail as unknown as Record<string, unknown>,
          })
        )
      )

      logger.info({ emailId: event.data.email_id, jobCount: matchingInboxes.length }, 'Enqueued jobs for email webhook')
      return NextResponse.json({ message: 'Webhook received and queued for processing' })
    } else {
      // SYNC PATH: Store emails, dispatch automations, and run LLM enrichment
      // inline (500ms-2s). Blocks the webhook response on database and API
      // latency. Used when async processing is disabled or Redis is unavailable.
      //
      // Mirrors the async worker's per-message steps (lib/webhooks/worker.ts)
      // so a message processed synchronously isn't missing anything a message
      // processed via the queue would have gotten.
      const storedMessages = await Promise.all(
        matchingInboxes.map((inbox) =>
          storeIncomingEmail(resendEmail, [inbox.id])
        )
      )
      const created = storedMessages.flat()

      // Trigger automation workflows for newly stored messages
      await Promise.all(
        created.map((message) => dispatchAutomationsForEmail(message.id))
      )

      // LLM enrichment (best-effort, never throws) — mirrors the worker's
      // Step 3. Every message here is a fresh insert (storeIncomingEmail only
      // returns newly created rows), so enrichedAt is always unset going in.
      // Only mark it once enrichMessage reports the step settled: unlike the
      // async worker, the sync path has no queue to retry an unsettled
      // message, so leaving enrichedAt unset on a transient failure doesn't
      // get it retried automatically — it just keeps the marker honest rather
      // than falsely claiming a failed attempt succeeded.
      await Promise.all(
        created.map(async (message) => {
          const settled = await enrichMessage(message.id)
          if (settled) {
            await prisma.emailMessage.update({
              where: { id: message.id },
              data: { enrichedAt: new Date() },
            })
          }
        })
      )

      return NextResponse.json({ message: 'Webhook processed' })
    }
  } catch (error) {
    logger.error({ error }, 'Failed to process email webhook')
    return NextResponse.json({ message: 'Webhook processing failed' }, { status: 500 })
  }
})
