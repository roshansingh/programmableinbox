import 'server-only'
import { prisma } from '@/lib/db'
import logger from '@/lib/logger'
import { SmsProviderError } from '@/lib/sms/errors'
import { purchaseNumber, releaseNumber } from '@/lib/sms/numbers'
import { isE164, type SmsCountry } from '@/lib/sms/validation'
import type { OwnerScope, PhoneWriteScope } from './scope'

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
 * Buys a number and records it, in three steps whose order is the point:
 *
 * 1. **Reserve.** Insert a `pending` row. The partial unique index on live
 *    numbers makes this the arbiter: of two requests racing for one number,
 *    exactly one insert succeeds, and the other never reaches Twilio. Buying
 *    first and recording after would let both pay.
 * 2. **Purchase.** Call Twilio. A refusal marks the row `failed` (which holds no
 *    number, so a retry is possible).
 * 3. **Activate.** Store the Twilio sid. If *that* write fails the number is
 *    already ours and billed, so it is released again rather than orphaned.
 */
export async function provisionPhoneInbox(
  scope: PhoneWriteScope,
  input: { phoneNumber: string; countryCode: SmsCountry },
) {
  if (!isE164(input.phoneNumber)) {
    throw new RangeError('phoneNumber must be in E.164 format')
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
    await markFailed(reserved.id)
    if (error instanceof SmsProviderError && error.kind === 'invalid-request') {
      throw new NumberUnavailableError()
    }
    throw error
  }

  try {
    return await prisma.phoneInbox.update({
      where: { id: reserved.id },
      data: { status: 'active', twilioSid: bought.sid, capabilities: bought.capabilities },
    })
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
 * destructive act on an inbox.
 *
 * Twilio first, database second. If the order were reversed, a Twilio outage
 * would leave a deleted row and a number still billed with nothing pointing at
 * it. This way a failure leaves the row `active` and the delete retryable, and
 * a crash between the two steps heals on retry because `releaseNumber` treats a
 * number Twilio no longer has as released.
 *
 * Setting `status` is what frees the number for re-purchase; `deletedAt` alone
 * would not (the live-number index is on `status`).
 */
export async function releasePhoneInbox(
  scope: OwnerScope,
  id: string,
): Promise<'released' | 'not-found'> {
  const inbox = await prisma.phoneInbox.findFirst({
    where: { id, userId: scope.userId, status: 'active' },
  })
  if (!inbox?.twilioSid) return 'not-found'

  await releaseNumber(inbox.twilioSid)

  const now = new Date()
  await prisma.phoneInbox.update({
    where: { id },
    data: { status: 'released', releasedAt: now, deletedAt: now },
  })
  return 'released'
}
