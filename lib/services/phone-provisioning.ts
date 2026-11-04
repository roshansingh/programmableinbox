import 'server-only'
import { prisma } from '@/lib/db'
import logger from '@/lib/logger'
import { SmsProviderError } from '@/lib/sms/errors'
import { findOwnedNumberSid, purchaseNumber, releaseNumber } from '@/lib/sms/numbers'
import { isNanpNumber, type SmsCountry } from '@/lib/sms/validation'
import type { OwnerScope, PhoneWriteScope } from './scope'

/**
 * How long a `pending` reservation is presumed to have a purchase in flight. A
 * purchase is one Twilio round trip, so a reservation older than this was
 * abandoned by a crash or restart and may be cleared by its creator. Younger
 * than this, deleting it could race the request that still owns it.
 */
const STALE_PENDING_MS = 5 * 60 * 1000

/**
 * The number cannot be had: another request holds it, or Twilio no longer sells
 * it. A caller-visible condition (409), not a failure of ours.
 */
export class NumberUnavailableError extends Error {
  constructor() {
    super('That number is no longer available')
    this.name = 'NumberUnavailableError'
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002'
}

/**
 * Best effort by design: this runs on a path that is already failing, and a
 * second exception here would replace the one the caller needs to see.
 */
async function markFailed(id: string): Promise<void> {
  try {
    await prisma.phoneInbox.update({ where: { id }, data: { status: 'failed' } })
  } catch (error) {
    logger.error({ error, phoneInboxId: id }, 'could not mark phone inbox failed')
  }
}

/**
 * After a purchase whose outcome is unknown (the answer was lost, so Twilio may
 * have sold the number and billed for it), release whatever the account holds
 * under that number.
 *
 * Safe because the caller owns the reservation: the live-number index means no
 * one else can legitimately hold this number meanwhile. Best effort for the same
 * reason as `markFailed`, but a failure here is logged with the number, since a
 * person then has to reconcile it by hand.
 */
async function releaseStrayNumber(phoneNumber: string, phoneInboxId: string): Promise<void> {
  try {
    const sid = await findOwnedNumberSid(phoneNumber)
    if (!sid) return
    await releaseNumber(sid)
    logger.warn({ phoneNumber, twilioSid: sid, phoneInboxId }, 'released a number whose purchase answer was lost')
  } catch (error) {
    logger.error(
      { error, phoneNumber, phoneInboxId },
      'could not confirm whether an uncertain purchase went through; the number may still be billed',
    )
  }
}

/**
 * Buys a number and records it, in three steps whose order is the point:
 *
 * 1. **Reserve.** Insert a `pending` row. The partial unique index on live
 *    numbers makes this the arbiter: of two requests racing for one number,
 *    exactly one insert wins, and the other never reaches Twilio. Buying first
 *    and recording after would let both pay.
 * 2. **Purchase.** Call Twilio. A refusal marks the row `failed` (which holds no
 *    number, so a retry is possible). A failure that does not prove nothing was
 *    bought — a timeout, a dropped connection — is followed by a lookup, because
 *    Twilio may have sold the number without our ever learning its sid.
 * 3. **Activate.** Store the Twilio sid, but only while the row is still
 *    `pending`: if the reservation was cleared in the meantime the number is
 *    released rather than resurrecting a deleted row. If the write itself fails
 *    the number is already ours and billed, so it is released again rather than
 *    orphaned.
 *
 * A crash between steps 2 and 3 leaves a `pending` row; its creator can clear it
 * with `releasePhoneInbox` once it is stale.
 */
export async function provisionPhoneInbox(
  scope: PhoneWriteScope,
  input: { phoneNumber: string; countryCode: SmsCountry },
) {
  if (!isNanpNumber(input.phoneNumber)) {
    throw new RangeError('phoneNumber must be a US or Canadian number in E.164 format')
  }

  let reserved
  try {
    reserved = await prisma.phoneInbox.create({
      data: {
        organizationId: scope.organizationId,
        userId: scope.userId,
        phoneNumber: input.phoneNumber,
        countryCode: input.countryCode,
        status: 'pending',
      },
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new NumberUnavailableError()
    throw error
  }

  let bought
  try {
    bought = await purchaseNumber(input.phoneNumber)
  } catch (error) {
    if (error instanceof SmsProviderError && error.kind === 'invalid-request') {
      await markFailed(reserved.id)
      throw new NumberUnavailableError()
    }

    // `auth` and `rate-limited` prove the request was refused. Anything else
    // (`unavailable`, `unknown`, a non-provider error) might have been a sale
    // whose answer was lost.
    const refused =
      error instanceof SmsProviderError && (error.kind === 'auth' || error.kind === 'rate-limited')
    if (!refused) await releaseStrayNumber(input.phoneNumber, reserved.id)

    await markFailed(reserved.id)
    throw error
  }

  try {
    const activated = await prisma.phoneInbox.updateMany({
      where: { id: reserved.id, status: 'pending' },
      data: { status: 'active', twilioSid: bought.sid, capabilities: bought.capabilities },
    })
    if (activated.count === 0) {
      throw new Error('The reservation was cancelled while the number was being bought')
    }
    return await prisma.phoneInbox.findUniqueOrThrow({ where: { id: reserved.id } })
  } catch (error) {
    try {
      await releaseNumber(bought.sid)
    } catch (releaseError) {
      // Money is now leaking and a person has to reconcile it; say which number.
      logger.error(
        { error: releaseError, twilioSid: bought.sid, phoneInboxId: reserved.id },
        'purchased number could not be released after the database write failed',
      )
    }
    await markFailed(reserved.id)
    throw error
  }
}

/**
 * Releases a number and retires the inbox. Creator-only, like every other
 * destructive act on an inbox, and only while the creator is still a member of
 * the organization: release is irreversible and returns the number to the public
 * pool, so authority over it cannot outlive membership.
 *
 * Twilio first, database second. If the order were reversed, a Twilio outage
 * would leave a deleted row and a number still billed with nothing pointing at
 * it. This way a failure leaves the row `active` and the delete retryable, and
 * a crash between the two steps heals on retry because `releaseNumber` treats a
 * number Twilio no longer has as released.
 *
 * Setting `status` is what frees the number for re-purchase; `deletedAt` alone
 * would not (the live-number index is on `status`).
 *
 * A `pending` row can be cleared too, but only once it is stale: it then has no
 * sid, so Twilio is asked what the account holds under that number and any hit
 * is released before the row is retired.
 */
export async function releasePhoneInbox(
  scope: OwnerScope,
  id: string,
): Promise<'released' | 'not-found'> {
  const staleBefore = new Date(Date.now() - STALE_PENDING_MS)
  const inbox = await prisma.phoneInbox.findFirst({
    where: {
      id,
      userId: scope.userId,
      organization: { memberships: { some: { userId: scope.userId } } },
      OR: [{ status: 'active' }, { status: 'pending', createdAt: { lt: staleBefore } }],
    },
  })
  if (!inbox) return 'not-found'

  const now = new Date()

  if (inbox.status === 'pending') {
    const sid = await findOwnedNumberSid(inbox.phoneNumber)
    if (sid) await releaseNumber(sid)
    await prisma.phoneInbox.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'failed', deletedAt: now },
    })
    return 'released'
  }

  if (!inbox.twilioSid) return 'not-found'
  await releaseNumber(inbox.twilioSid)
  await prisma.phoneInbox.update({
    where: { id },
    data: { status: 'released', releasedAt: now, deletedAt: now },
  })
  return 'released'
}
