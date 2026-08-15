import 'server-only'
import { prisma } from '@/lib/db'
import { Prisma } from '@/lib/generated/prisma/client'
import { MAX_UNPAGINATED_ROWS } from '@/lib/pagination/params'
import { encodeCursor, type DecodedCursor } from '@/lib/pagination/cursor'
import { fetchGroupedThreadHeads, type GroupedThreadHead } from './grouped-query'
import { fetchSearchedMessages } from './message-search'
import type { MessageSearch } from '@/lib/search/message-search-params'
import { parseInboxAddress } from '@/lib/email-address'
import { validateInboxAddress, validateInboxName } from '@/lib/validation/inbox-policy'
import { INVALID_ADDRESS } from '@/lib/validation/inbox-policy-messages'
import { isUniqueViolation } from '@/lib/api-helpers'
import { checkResourceLimit } from '@/lib/commercial/enforce'
import type { OrgScope, OwnerScope, InboxWriteScope, InboxDeleteScope } from './scope'

type EmailInboxRow = Awaited<ReturnType<typeof prisma.emailInbox.create>>

export type ListMessagesOptions = {
  limit: number
  cursor: DecodedCursor | null
  threadId?: string | null
  grouped?: boolean
  /**
   * Search filters, or null when the request is a plain listing (issue #106).
   *
   * Null rather than an all-empty object so the non-searching path — every
   * request the dashboard makes today — keeps its existing Prisma query and
   * query plan untouched, instead of routing through raw SQL to apply no
   * filters. `parseMessageSearch` produces exactly this shape.
   */
  search?: MessageSearch | null
}

type EmailMessageRow = Awaited<ReturnType<typeof prisma.emailMessage.findMany>>[number]

/**
 * The grouped thread-list view comes from raw SQL and is a different shape from
 * a full message row — it carries threadCount and only the columns the query
 * projects. Both paths land in the same result, so the row type is the union of
 * the two rather than the message row alone. Serializers narrow it per surface.
 */
export type MessageListRow = EmailMessageRow | GroupedThreadHead

export type ListMessagesResult = {
  messages: MessageListRow[]
  nextCursor: string | null
  hasMore: boolean
}

export async function listInboxes(scope: OrgScope, opts: { limit?: number } = {}) {
  return prisma.emailInbox.findMany({
    where: { organizationId: { in: scope.organizationIds } },
    // Deterministic order is required, not cosmetic: without it an unordered
    // scan may return a different arbitrary subset each time the ceiling
    // truncates. id breaks createdAt ties so the cut is stable.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit ?? MAX_UNPAGINATED_ROWS,
  })
}

export async function getInbox(scope: OrgScope, id: string) {
  // The organization constraint is in the query, not a post-hoc check on the
  // result, so there is no code path that loads a row it may not return.
  return prisma.emailInbox.findFirst({
    where: { id, organizationId: { in: scope.organizationIds } },
  })
}

export async function listMessages(
  scope: OrgScope,
  inboxId: string,
  opts: ListMessagesOptions,
): Promise<ListMessagesResult | null> {
  const inbox = await getInbox(scope, inboxId)
  if (!inbox) return null

  const take = opts.limit + 1

  // Search: an additional WHERE over the same ordering and cursor, served by raw
  // SQL because the tsvector column is Unsupported in the Prisma schema. Checked
  // before the grouped branch because the two are mutually exclusive — the route
  // has already rejected grouped+search with a 400 (see parseMessageSearch).
  if (opts.search) {
    const rows = await fetchSearchedMessages(inboxId, opts.search, {
      threadId: opts.threadId,
      cursor: opts.cursor,
      take,
    })
    return page(rows, opts.limit)
  }

  // Grouped thread-list view: one row (latest message) per thread.
  if (opts.grouped && !opts.threadId) {
    const rows = await fetchGroupedThreadHeads(inboxId, opts.cursor, take)
    return page(rows, opts.limit)
  }

  // Flat inbox list (newest first) or single-thread view (oldest first).
  // The direction flip is load-bearing: a thread reads top-to-bottom, an inbox
  // reads newest-first, and the cursor comparison must match the orderBy or
  // pagination silently skips or repeats rows.
  const asc = Boolean(opts.threadId)

  const where: Prisma.EmailMessageWhereInput = { inboxEmailAddressId: inboxId }
  if (opts.threadId) where.threadId = opts.threadId
  if (opts.cursor) {
    where.OR = asc
      ? [
          { createdAt: { gt: opts.cursor.createdAt } },
          { createdAt: opts.cursor.createdAt, id: { gt: opts.cursor.id } },
        ]
      : [
          { createdAt: { lt: opts.cursor.createdAt } },
          { createdAt: opts.cursor.createdAt, id: { lt: opts.cursor.id } },
        ]
  }

  const rows = await prisma.emailMessage.findMany({
    where,
    orderBy: [{ createdAt: asc ? 'asc' : 'desc' }, { id: asc ? 'asc' : 'desc' }],
    take,
  })

  return page(rows, opts.limit)
}

function page(rows: ListMessagesResult['messages'], limit: number): ListMessagesResult {
  const hasMore = rows.length > limit
  const messages = hasMore ? rows.slice(0, limit) : rows
  return {
    messages,
    hasMore,
    nextCursor: hasMore ? encodeCursor(messages[messages.length - 1]) : null,
  }
}

/** How many recent messages `findLatestOtp` scans for one carrying a code. */
export const OTP_SCAN_LIMIT = 25

/** Default freshness window for an OTP, in minutes. */
export const OTP_DEFAULT_WINDOW_MINUTES = 15

export type LatestOtpResult =
  | { found: true; message: MessageListRow }
  // Distinguishes "a code arrived but is older than the window" from
  // "nothing arrived at all" — the fix differs (raise the window vs. wait and
  // retry), so collapsing the two loses information every caller needs.
  | { found: false; stale: boolean }

/**
 * The shared core of "read the code back for this inbox" — used by both the
 * v1 REST route and the MCP tool (pibx_email_get_latest_otp), so the scan
 * depth, freshness window and staleness distinction live in one place rather
 * than two copies that can drift. Callers serialize `message` per surface.
 *
 * Returns null when the inbox itself is not visible to `scope`, exactly like
 * `listMessages` — a caller distinguishes that from "no OTP yet" by checking
 * for null before `found`.
 */
export async function findLatestOtp(
  scope: OrgScope,
  inboxId: string,
  opts: { search?: MessageSearch | null; windowMinutes?: number } = {},
): Promise<LatestOtpResult | null> {
  const result = await listMessages(scope, inboxId, {
    limit: OTP_SCAN_LIMIT,
    cursor: null,
    threadId: null,
    grouped: false,
    search: opts.search ?? null,
  })
  if (!result) return null

  const windowMinutes = opts.windowMinutes ?? OTP_DEFAULT_WINDOW_MINUTES
  const cutoff = Date.now() - windowMinutes * 60_000
  const rows = result.messages as Array<MessageListRow & { extractedOtp: string | null }>
  const match = rows.find((row) => row.extractedOtp !== null && row.createdAt.getTime() >= cutoff)

  if (!match) {
    const stale = rows.some((row) => row.extractedOtp !== null)
    return { found: false, stale }
  }

  return { found: true, message: match }
}

export async function getMessage(scope: OrgScope, inboxId: string, messageId: string) {
  const inbox = await getInbox(scope, inboxId)
  if (!inbox) return null

  return prisma.emailMessage.findFirst({
    where: { id: messageId, inboxEmailAddressId: inboxId },
  })
}

/**
 * Mutations are creator-scoped, not organization-scoped (2026-07-30 split spec
 * §7.1). Reads widened to the organization; mutation authority deliberately did
 * not. Organization-wide delete would let any member destroy any inbox, which
 * cascades to its messages and permanently retires the address — soft-deleted
 * rows keep their `email` so it can never be reclaimed.
 *
 * Every function here resolves ownership through a single `userId`-constrained
 * lookup, so there is no path that mutates a row it did not first prove is owned.
 */
async function ownedInbox(owner: OwnerScope, id: string) {
  return prisma.emailInbox.findFirst({ where: { id, userId: owner.userId } })
}

// ---------------------------------------------------------------------------
// Inbox writes reachable by an API key (`email_inboxes:write`)
// ---------------------------------------------------------------------------

/**
 * Deliberately identical whether the address is held by another tenant or by a
 * soft-deleted inbox, so creation cannot be used to probe which addresses exist
 * in other orgs.
 */
const ADDRESS_UNAVAILABLE = 'Email address is not available'

const EMAIL_IMMUTABLE = 'The address of an inbox cannot be changed. Create a new inbox instead.'

/**
 * A caller-correctable rejection, carrying the status the HTTP surface should
 * return and the wording the MCP surface should put in its tool text.
 *
 * Returned rather than thrown so a route cannot forget to handle it, and so the
 * two surfaces cannot drift on what a given failure means — which is the whole
 * reason this logic moved out of the app route in the first place.
 */
/**
 * `limit`/`used`/`planCode` are present only on a 402 from a plan cap
 * (`PlanDenial`), and let a route forward an accurate upsell instead of a bare
 * message.
 */
export type InboxWriteError = {
  message: string
  status: number
  limit?: number
  used?: number
  planCode?: string
}

export type InboxWriteResult<T> = { inbox: T; error?: never } | { inbox?: never; error: InboxWriteError }

/**
 * The single implementation of "make an inbox", for every caller.
 *
 * This used to live inline in `app/api/app/emailInbox/route.ts`. Adding
 * `POST /api/v1/emailInbox` and an MCP tool would have made three copies of
 * the address normalization, the issue #98 policy, the probe-resistant 409 and
 * the unique-violation catch — and the copy that fell behind would have been
 * one of the ones enforcing the anti-impersonation rules.
 */
export async function createInbox(
  scope: InboxWriteScope,
  input: { email: unknown; name?: unknown },
): Promise<InboxWriteResult<EmailInboxRow>> {
  // Normalize before anything compares or stores the address (F1). Inbound
  // routing matches on the lowercased recipient, so claiming must happen in
  // that same space — otherwise `Billing@corp.com` and `billing@corp.com` are
  // two rows to the unique index but one address to the router, and the second
  // claimant intercepts the first's mail.
  // A null organization means the caller is a user who did not say where the
  // inbox goes. Updates tolerate that — the row already has an organization —
  // but creation cannot guess, and an inbox cannot be moved afterwards. A key
  // is always bound, so this is unreachable for one.
  const { organizationId } = scope
  if (!organizationId) return { error: { message: 'organizationId is required', status: 400 } }

  const address = parseInboxAddress(input.email)
  if (!address) return { error: { message: INVALID_ADDRESS, status: 400 } }

  // Policy runs before the address is claimed and before the table is touched
  // at all (issue #98). Syntax validation only proves the address is
  // well-formed; these prove it is one we can receive at, and that it does not
  // impersonate a brand or the platform on a domain we own.
  const addressViolation = validateInboxAddress(address)
  if (addressViolation) return { error: addressViolation }

  const nameViolation = validateInboxName(input.name)
  if (nameViolation) return { error: nameViolation }

  // Plan cap (issue #117 §6c), after the address and name are judged: a
  // malformed address is a 400 about the request, not a 402 about billing, and
  // telling a caller who mistyped an address that they need to upgrade would be
  // actively misleading.
  //
  // Counts live inboxes only — the soft-delete extension injects
  // `deletedAt: null` into `count` automatically (lib/db-soft-delete.ts), so a
  // deleted inbox frees a plan slot. It does not free the *address*: the row
  // survives holding it and `EmailInbox.email` is globally unique.
  const denial = await checkResourceLimit(organizationId, 'emailInboxes', 'email inbox', () =>
    prisma.emailInbox.count({ where: { organizationId } }),
  )
  if (denial) return { error: denial }

  // Store the value the policy actually judged. Persisting the raw string while
  // validating the trimmed one lets `" "` through as a name that validated as
  // absent — and any padding survives into every listing.
  const name = typeof input.name === 'string' ? input.name.trim() || null : null

  // Friendly pre-check. Not authoritative: reads are soft-delete filtered, so
  // an address held by a deleted inbox is invisible here, and two concurrent
  // requests can both pass. The unique index below is what decides.
  const existing = await prisma.emailInbox.findFirst({
    where: { email: address },
    select: { id: true },
  })
  if (existing) return { error: { message: ADDRESS_UNAVAILABLE, status: 409 } }

  try {
    const inbox = await prisma.emailInbox.create({
      data: {
        organizationId,
        userId: scope.userId,
        email: address,
        name,
      },
    })
    return { inbox }
  } catch (error) {
    // Same wording and status as the pre-check. A distinguishable answer here
    // would reveal that a soft-deleted inbox holds the address.
    if (isUniqueViolation(error, 'email')) {
      return { error: { message: ADDRESS_UNAVAILABLE, status: 409 } }
    }
    // Anything else is ours, not the caller's. Rethrow so the route logs it and
    // answers 500 rather than reporting a database fault as a bad request.
    throw error
  }
}

/**
 * Resolves an inbox a write scope is allowed to mutate.
 *
 * Constrained by creator, and additionally by organization when the scope
 * names one. Organization-only would let any member rename a colleague's
 * inbox, which is a behaviour change nobody asked for; creator-only is what
 * `OwnerScope` gave and is what a dashboard PATCH still gets. A key always
 * carries an organization, which is what stops it writing into another org its
 * minter happens to belong to. Its rule reads simply: a key can manage what it
 * created, since inboxes it creates are attributed to the user who minted it.
 */
export async function getInboxForWrite(scope: InboxWriteScope, id: string) {
  return reachableInbox(scope, id)
}

/**
 * The predicate shared by every scoped inbox mutation.
 *
 * Takes the structural shape rather than either branded scope type, so update
 * and delete resolve a row identically without one of them being able to pass
 * its scope to the other's service. It is not exported: a caller outside this
 * module would have to construct the shape by hand, which is exactly the
 * unchecked authority the scope types exist to prevent.
 *
 * The organization narrowing is added only when the scope carries one.
 * `organizationId: null` in the predicate would match nothing at all, since the
 * column is NOT NULL — a dashboard request would 404 on its own inbox.
 */
async function reachableInbox(
  scope: { userId: string; organizationId: string | null },
  id: string,
) {
  return prisma.emailInbox.findFirst({
    where: {
      id,
      userId: scope.userId,
      ...(scope.organizationId !== null && { organizationId: scope.organizationId }),
    },
  })
}

export async function updateInboxForWrite(
  scope: InboxWriteScope,
  id: string,
  input: { email?: unknown; name?: unknown },
): Promise<InboxWriteResult<EmailInboxRow>> {
  // Resolved before any body field is inspected. Answering a body-shaped
  // question first would tell a caller with no authority to mutate that the
  // inbox exists and that their address guess was wrong.
  const existing = await getInboxForWrite(scope, id)
  if (!existing) return { error: { message: 'Not found', status: 404 } }

  // The address is immutable once the inbox exists (F1). Re-pointing it was a
  // second route to cross-tenant interception — claim a throwaway address, then
  // move it onto a case variant of a tenant's — and it breaks the guarantee
  // that a delivered message's recipient still names a live inbox.
  //
  // A submission matching the current address after normalization is a no-op
  // and allowed, so a client can PATCH a full record back to rename it.
  //
  // Syntax is judged before the comparison. `parseInboxAddress` answers `null`
  // for anything malformed, so folding the two together reported `not-an-email`
  // as "the address is immutable" (409) — a caller who mistyped an address they
  // were not trying to change would be told the field is frozen rather than
  // that their input is invalid, and the answer disagreed with `createInbox`,
  // which 400s the same string. Order is safe: `existing` is already resolved,
  // so neither branch is reachable without mutation authority.
  if (input.email !== undefined) {
    const submitted = parseInboxAddress(input.email)
    if (!submitted) return { error: { message: INVALID_ADDRESS, status: 400 } }
    if (submitted !== existing.email) {
      return { error: { message: EMAIL_IMMUTABLE, status: 409 } }
    }
  }

  // The same name policy as creation (issue #98). Without it the blocklist is
  // worthless: an inbox created as `qa` could simply be renamed to
  // `Amazon Support` afterwards, and the display name is what a recipient reads.
  const nameViolation = validateInboxName(input.name)
  if (nameViolation) return { error: nameViolation }

  const name =
    input.name === undefined ? undefined : typeof input.name === 'string' ? input.name.trim() || null : null

  const inbox = await prisma.emailInbox.update({
    where: { id },
    data: { ...(name !== undefined && { name }) },
  })

  return { inbox }
}

/**
 * Soft-deletes an inbox and its messages.
 *
 * Takes an `InboxDeleteScope`, not an `OwnerScope`: `email_inboxes:delete` puts
 * this within reach of an API key that holds it, and nothing else. A key with
 * create or update cannot call this — its scope is a different type.
 *
 * What is and is not reversible here is worth being exact about, because the
 * scope description promises it to whoever ticks the box. The rows are stamped,
 * not removed, and every read filters them out through the client extension in
 * lib/db.ts — so the data survives. The address does not come back: it stays
 * claimed by the unique index on `EmailInbox.email` forever, and there is no
 * restore path in this codebase.
 */
export async function deleteInbox(scope: InboxDeleteScope, id: string): Promise<boolean> {
  const inbox = await reachableInbox(scope, id)
  if (!inbox) return false

  // The inbox and its messages are stamped in the same transaction so neither
  // can be served while the other is hidden. The row is kept rather than
  // removed so its address stays claimed by the unique index (F1).
  const deletedAt = new Date()
  await prisma.$transaction([
    prisma.emailMessage.updateMany({
      where: { inboxEmailAddressId: id, deletedAt: null },
      data: { deletedAt },
    }),
    prisma.emailInbox.update({ where: { id }, data: { deletedAt } }),
  ])

  return true
}

export async function setMessageStarred(
  owner: OwnerScope,
  inboxId: string,
  messageId: string,
  isStarred: boolean,
) {
  const inbox = await ownedInbox(owner, inboxId)
  if (!inbox) return null

  const message = await prisma.emailMessage.findFirst({
    where: { id: messageId, inboxEmailAddressId: inboxId },
  })
  if (!message) return null

  return prisma.emailMessage.update({ where: { id: messageId }, data: { isStarred } })
}

export async function deleteMessage(
  owner: OwnerScope,
  inboxId: string,
  messageId: string,
): Promise<boolean> {
  const inbox = await ownedInbox(owner, inboxId)
  if (!inbox) return false

  const message = await prisma.emailMessage.findFirst({
    where: { id: messageId, inboxEmailAddressId: inboxId },
  })
  if (!message) return false

  await prisma.emailMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  })

  return true
}
