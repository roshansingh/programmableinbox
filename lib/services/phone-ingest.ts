import 'server-only'
import { isUniqueViolation } from '@/lib/api-helpers'
import { CommercialProvider } from '@/lib/commercial/provider'
import { prisma } from '@/lib/db'
import logger from '@/lib/logger'
import type { ParsedInboundSms } from '@/lib/sms/webhook'

/**
 * - `stored`: a new row was written.
 * - `duplicate`: Twilio re-delivered a MessageSid we already have.
 * - `dropped`: the organization is over its plan quota; nothing was stored.
 * - `no-inbox`: no active inbox holds the number the message was addressed to.
 */
export type IngestOutcome = 'stored' | 'duplicate' | 'dropped' | 'no-inbox'

/**
 * Stores one inbound SMS.
 *
 * Only an `active` inbox receives. At most one live row can hold a number (the
 * partial unique index from #141), so this lookup cannot match two
 * organizations; a number that changed hands resolves to its current holder, and
 * old messages stay with the row they arrived on. A `pending` inbox is skipped:
 * its purchase has not been confirmed, and the window is the instant between
 * Twilio selling the number and our activating write.
 *
 * Quota follows the email path (`storeIncomingEmail`), for the same reasons:
 * consumed *before* the insert, because the statement behind `consume` is
 * atomic and consuming afterwards would let concurrent deliveries all observe
 * the same usage; refunded when the insert did not add a row, because Twilio
 * retries and every retry would otherwise spend an allowance never used.
 *
 * Throws on a store failure that is not a duplicate, *after* refunding, so the
 * route can answer 500 and Twilio may retry. Everything else is an outcome, not
 * an error: answering non-2xx for an unknown number or a full quota would only
 * make Twilio retry something that can never succeed.
 */
export async function storeIncomingSms(msg: ParsedInboundSms): Promise<IngestOutcome> {
  const inbox = await prisma.phoneInbox.findFirst({
    where: { phoneNumber: msg.to, status: 'active', deletedAt: null },
    select: { id: true, organizationId: true },
  })
  if (!inbox) {
    logger.info({ externalId: msg.externalId, to: msg.to }, 'Inbound SMS for a number with no active inbox')
    return 'no-inbox'
  }

  // Resolved once and threaded through every quota call, as email does.
  const plan = await CommercialProvider.plans.resolve(inbox.organizationId)

  // A subscription that lapses resolves to a plan without phone inboxes, but the
  // number stays active at Twilio until someone releases it, and a plan with no
  // SMS limit key means "unlimited". The feature flag is what stops that traffic.
  if (!plan.limits.phoneInboxesEnabled) {
    await CommercialProvider.quota.increment(inbox.organizationId, 'sms.dropped', 1, plan)
    logger.warn(
      { phoneInboxId: inbox.id, organizationId: inbox.organizationId, externalId: msg.externalId, planCode: plan.planCode },
      'Inbound SMS dropped: the organization plan does not include phone inboxes',
    )
    return 'dropped'
  }

  const quota = await CommercialProvider.quota.consume(inbox.organizationId, 'sms.received', 1, plan)

  if (!quota.allowed) {
    // Twilio's retry of a message we already stored is refused too, once the cap
    // is reached. It is not a loss: reporting it as one would inflate the very
    // number the dashboard shows as "messages lost".
    const existing = await prisma.phoneMessage.findUnique({
      where: { externalId: msg.externalId },
      select: { id: true },
    })
    if (existing) return 'duplicate'

    // Dropped, not stored-and-flagged: it cannot be recovered by upgrading.
    // `sms.dropped` is what lets the dashboard say how much was lost.
    await CommercialProvider.quota.increment(inbox.organizationId, 'sms.dropped', 1, plan)
    logger.warn(
      {
        phoneInboxId: inbox.id,
        organizationId: inbox.organizationId,
        externalId: msg.externalId,
        limit: quota.limit,
        used: quota.used,
      },
      'Inbound SMS dropped: organization is over its plan quota',
    )
    return 'dropped'
  }

  try {
    await prisma.phoneMessage.create({
      data: {
        phoneInboxId: inbox.id,
        organizationId: inbox.organizationId,
        from: msg.from,
        to: msg.to,
        body: msg.body,
        mediaCount: msg.mediaCount,
        externalId: msg.externalId,
        threadId: `${inbox.id}:${msg.from}`,
      },
    })
    return 'stored'
  } catch (error) {
    // The refund is best effort. If it throws too (likely in the same outage),
    // letting it escape would replace the error that explains the failure.
    try {
      await CommercialProvider.quota.refund(inbox.organizationId, 'sms.received', 1, plan)
    } catch (refundError) {
      logger.error(
        { error: refundError, organizationId: inbox.organizationId, externalId: msg.externalId },
        'Could not refund an inbound SMS quota unit',
      )
    }

    if (isUniqueViolation(error, 'externalId')) {
      logger.info({ phoneInboxId: inbox.id, externalId: msg.externalId }, 'Duplicate inbound SMS skipped')
      return 'duplicate'
    }

    logger.error({ error, phoneInboxId: inbox.id, externalId: msg.externalId }, 'Failed to store inbound SMS')
    throw error
  }
}
