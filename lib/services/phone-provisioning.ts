import 'server-only'
import { prisma } from '@/lib/db'
import logger from '@/lib/logger'
import { SmsProviderError } from '@/lib/sms/errors'
import { findOwnedNumberSid, isNumberAvailable, purchaseNumber, releaseNumber } from '@/lib/sms/numbers'
import { isNanpNumber, type SmsCountry } from '@/lib/sms/validation'
import type { OwnerScope, PhoneWriteScope } from './scope'

/**
 * How long a `pending` reservation is presumed to have a purchase in flight. A
 * purchase is one Twilio round trip, so a reservation untouched for longer than
 * this was abandoned by a crash or restart and may be cleared by its creator.
 * Younger than this, clearing it could race the request that still owns it.
 *
 * Staleness is measured on `updatedAt`, which doubles as a lease: a pending row
 * is written once at creation, so `updatedAt` equals `createdAt` until a cleaner
 * *claims* it by bumping `updatedAt`. That one conditional write is what makes
 * "who may act on this reservation" a single atomic decision.
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
 * one else can legitimately hold this number meanwhile.
 *
 * Returns whether the outcome is *confirmed* — nothing was held, or what was held
 * has been released. `false` means the number may still be billed, and the caller
 * must then leave the reservation `pending` rather than mark it `failed`: that
 * row is the only record of the number, and `failed` would hide it, drop its
 * lock, and put it out of `releasePhoneInbox`'s reach. Left `pending`, the
 * creator can clear it once stale, and that path looks the number up again.
 */
async function releaseStrayNumber(phoneNumber: string, phoneInboxId: string): Promise<boolean> {
  try {
    const sid = await findOwnedNumberSid(phoneNumber)
    if (!sid) return true
    await releaseNumber(sid)
    logger.warn({ phoneNumber, providerId: sid, phoneInboxId }, 'released a number whose purchase answer was lost')
    return true
  } catch (error) {
    logger.error(
      { error, phoneNumber, phoneInboxId },
      'could not confirm whether an uncertain purchase went through; the number may still be billed',
    )
    return false
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
 *    `pending` *and unclaimed* (`updatedAt` unchanged): if a cleanup took the
 *    lease or retired the reservation in the meantime, the number is released
 *    rather than attached to a row someone else is acting on. If the write itself
 *    fails the number is already ours and billed, so it is released again rather
 *    than orphaned.
 *
 * Before step 1 the number must be in the country's SMS-capable local inventory.
 * Whenever a cleanup cannot confirm that no number remains, the row stays
 * `pending` instead of `failed` (see `releaseStrayNumber`). A crash between
 * steps 2 and 3 likewise leaves a `pending` row; its creator can clear it with
 * `releasePhoneInbox` once it is stale.
 */
export async function provisionPhoneInbox(
  scope: PhoneWriteScope,
  input: { phoneNumber: string; countryCode: SmsCountry },
) {
  if (!isNanpNumber(input.phoneNumber)) {
    throw new RangeError('phoneNumber must be a US or Canadian number in E.164 format')
  }

  // Syntax is not eligibility: `+1` also covers toll-free and Caribbean numbers,
  // and the country label is client-supplied. Checked before reserving so a
  // crafted request leaves no row behind.
  if (!(await isNumberAvailable(input.countryCode, input.phoneNumber))) {
    throw new NumberUnavailableError()
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
    const confirmed = refused || (await releaseStrayNumber(input.phoneNumber, reserved.id))
    if (confirmed) await markFailed(reserved.id)
    throw error
  }

  try {
    const activated = await prisma.phoneInbox.updateMany({
      where: { id: reserved.id, status: 'pending', updatedAt: reserved.updatedAt },
      data: { status: 'active', providerId: bought.sid, capabilities: bought.capabilities },
    })
    if (activated.count === 0) {
      throw new Error('The reservation was cancelled while the number was being bought')
    }
    return await prisma.phoneInbox.findUniqueOrThrow({ where: { id: reserved.id } })
  } catch (error) {
    let released = false
    try {
      await releaseNumber(bought.sid)
      released = true
    } catch (releaseError) {
      // Money is now leaking and a person has to reconcile it; say which number.
      logger.error(
        { error: releaseError, providerId: bought.sid, phoneInboxId: reserved.id },
        'purchased number could not be released after the database write failed',
      )
    }
    // Only a confirmed release lets the row go `failed`; otherwise it stays
    // `pending` so the number stays visible, locked, and clearable.
    if (released) await markFailed(reserved.id)
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
 * is released before the row is retired. The cleaner first *claims* the row with
 * a conditional write that bumps `updatedAt`. Two concurrent clean-ups therefore
 * cannot both proceed (one loses the claim), and a purchase still completing
 * cannot activate the row afterwards (its activation is conditional on the old
 * `updatedAt`). The row stays `pending` — holding its number — until the clean-up
 * finishes; a clean-up that dies mid-way simply lets the lease lapse for a retry.
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
      OR: [{ status: 'active' }, { status: 'pending', updatedAt: { lt: staleBefore } }],
    },
  })
  if (!inbox) return 'not-found'

  const now = new Date()

  if (inbox.status === 'pending') {
    const claim = await prisma.phoneInbox.updateMany({
      where: { id, status: 'pending', updatedAt: inbox.updatedAt },
      data: { updatedAt: now },
    })
    if (claim.count === 0) return 'not-found'

    const sid = await findOwnedNumberSid(inbox.phoneNumber)
    if (sid) await releaseNumber(sid)
    await prisma.phoneInbox.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'failed', deletedAt: now },
    })
    return 'released'
  }

  if (!inbox.providerId) return 'not-found'
  await releaseNumber(inbox.providerId)
  await prisma.phoneInbox.update({
    where: { id },
    data: { status: 'released', releasedAt: now, deletedAt: now },
  })
  return 'released'
}
