import { prisma } from '@/lib/db'

/**
 * Auto-reply throttle (F17).
 *
 * The auto-reply action must send at most once per (automation, inbox, sender)
 * window. The old code read the ledger, checked the window, sent, then wrote —
 * a check-then-act race: two emails from the same sender processed concurrently
 * both read the stale `lastSentAt`, both passed the check, and both sent.
 *
 * The claim below collapses check-and-write into a single atomic step that runs
 * BEFORE the send, so concurrent callers elect exactly one winner. The send is
 * irreversible, so the claim must precede it; a failed send releases the claim.
 */

type ThrottleKey = { automationId: string; inboxId: string; fromEmail: string }

/** Sentinel for a released claim — old enough that the next attempt re-claims. */
const RELEASED = new Date(0)

/**
 * Minimal client surface this module needs — satisfied by the real Prisma
 * client and by test mocks alike. The default binds the real client via a cast,
 * since Prisma's generated method types are narrower than this structural shape.
 */
type LedgerClient = {
  autoReplyLedger: {
    updateMany: (args: { where: object; data: object }) => Promise<{ count: number }>
    create: (args: { data: object }) => Promise<unknown>
  }
}

const defaultClient = prisma as unknown as LedgerClient

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
}

/**
 * Atomically claims the auto-reply slot iff the throttle window has elapsed.
 * Returns true only for the single caller that won the claim and should send.
 *
 * Two mutually exclusive atomic paths:
 *  - `updateMany` conditioned on `lastSentAt < cutoff` claims an existing
 *    eligible row. Postgres row-locks serialize concurrent updaters, so a loser
 *    re-evaluates the predicate against the freshly-written `lastSentAt` and
 *    matches nothing (count 0).
 *  - if nothing was updated, `create` races to insert the first row; the loser
 *    gets a P2002 unique violation on `(automationId, inboxId, fromEmail)` and
 *    is throttled.
 */
export async function claimAutoReplySlot(
  key: ThrottleKey,
  cutoff: Date,
  claimAt: Date,
  client: LedgerClient = defaultClient,
): Promise<boolean> {
  const claimed = await client.autoReplyLedger.updateMany({
    where: { ...key, lastSentAt: { lt: cutoff } },
    data: { lastSentAt: claimAt },
  })
  if (claimed.count > 0) return true

  try {
    await client.autoReplyLedger.create({ data: { ...key, lastSentAt: claimAt } })
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
}

/**
 * Releases a claim won by `claimAutoReplySlot` when the send failed, so a retry
 * can re-claim. Guarded on `lastSentAt === claimAt` so it never clobbers a newer
 * legitimate claim (a concurrent winner or a later successful send).
 */
export async function releaseAutoReplySlot(
  key: ThrottleKey,
  claimAt: Date,
  client: LedgerClient = defaultClient,
): Promise<void> {
  await client.autoReplyLedger.updateMany({
    where: { ...key, lastSentAt: claimAt },
    data: { lastSentAt: RELEASED },
  })
}
