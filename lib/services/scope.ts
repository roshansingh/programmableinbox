import 'server-only'
import { jsonError } from '@/lib/api-helpers'
import type { UserPrincipal, ApiKeyPrincipal } from '@/lib/auth/principals'

/**
 * Who can SEE a resource. Organization-wide for both principal kinds — a user
 * gets every organization they belong to, a key gets the one it is bound to.
 *
 * Because both principals reduce to this same shape, services below the route
 * layer never see a principal and therefore cannot branch on credential type.
 * Every defect this split fixed lived in exactly such a branch.
 */
export type OrgScope = { organizationIds: string[] }

/**
 * Who can CHANGE a resource. Creator-only, and deliberately a different type
 * from OrgScope.
 *
 * Only a UserPrincipal can produce one, so no API key can reach a mutating
 * service — the compiler enforces this independently of which route tree the
 * handler lives in. Full organization-scoped mutation would let any member
 * delete any inbox, which cascades to its messages and permanently retires the
 * address (EmailInbox.email keeps soft-deleted rows so an address can never be
 * reclaimed).
 */
export type OwnerScope = { userId: string; readonly __scope?: 'owner' }

export type OrgScopeResult =
  | { scope: OrgScope; error?: never }
  | { scope?: never; error: Response }

/**
 * The single place a principal becomes an organization scope, and the single
 * place the membership check for a requested organization happens.
 *
 * Routes cannot construct an OrgScope any other way, so a route cannot narrow
 * to an organization without being checked. Leaving that check in the routes is
 * what produced the inconsistent tenancy predicates this split removed.
 */
export function toOrgScope(
  principal: UserPrincipal | ApiKeyPrincipal,
  requestedOrganizationId?: string | null,
): OrgScopeResult {
  const denied = { error: jsonError('Not authorized for this organization', 403) }

  if (principal.kind === 'apiKey') {
    if (requestedOrganizationId && requestedOrganizationId !== principal.organizationId) {
      return denied
    }
    return { scope: { organizationIds: [principal.organizationId] } }
  }

  const memberOf = principal.memberships.map((m) => m.organizationId)

  if (requestedOrganizationId) {
    if (!memberOf.includes(requestedOrganizationId)) return denied
    return { scope: { organizationIds: [requestedOrganizationId] } }
  }

  // A user belonging to no organization can see nothing. Returning an empty
  // scope would make every service call silently return no rows, which reads
  // as "you have no inboxes" rather than "your account is not set up".
  if (memberOf.length === 0) return denied

  return { scope: { organizationIds: memberOf } }
}

export function toOwnerScope(principal: UserPrincipal): OwnerScope {
  return { userId: principal.userId }
}

/**
 * Who can CREATE or UPDATE an inbox. A third type, deliberately.
 *
 * Covers `email_inboxes:create` and `email_inboxes:update`, and deliberately
 * NOT `email_inboxes:delete` — that has `InboxDeleteScope` below.
 *
 * The separate types are how the compiler keeps the three inbox capabilities
 * apart. Runtime scope checks live in one place per route or tool, and this
 * repo has already shipped one route that gated a write behind the wrong scope
 * (`messages:read`, see `withApiKey`). A type that cannot be passed to the
 * wrong service is what makes that class of mistake unrepresentable rather
 * than merely reviewed for.
 *
 * Create and update share one type while delete gets its own, because the two
 * are not equally expensive to confuse. Renaming an inbox when you meant to
 * create one is recoverable; deleting one is not — the row soft-deletes, but
 * `EmailInbox.email` is a plain unique index, so the address is retired for
 * good. The asymmetry is the point, not an oversight.
 *
 * `deleteMessage` and `setMessageStarred` stay on `OwnerScope` and remain
 * unreachable from any API key at all.
 *
 * One `organizationId`, not a list — a write has to land somewhere specific,
 * and an inbox cannot be moved afterwards.
 *
 * `organizationId` is nullable, and only a `UserPrincipal` can produce a null
 * one. That is what lets updates keep their existing creator-only semantics
 * for the dashboard while still binding a key to its organization. The
 * distinction is load-bearing for tenancy: a user can belong to several
 * organizations, so constraining a key's writes by `userId` alone would let a
 * key issued for org_1 rename an inbox in org_2 whenever its minter happens to
 * belong to both. `toInboxWriteScope` never returns a null organization for a
 * key, so that path does not exist.
 *
 * The `__scope` phantom on this and on `OwnerScope` is what makes them
 * genuinely different types. Structural typing alone does not: this shape has
 * every property `OwnerScope` has plus more, so without the discriminant it is
 * assignable to `OwnerScope` and `deleteInbox(writeScope, id)` compiles
 * cleanly. The property is optional and never assigned, so it costs nothing at
 * runtime and neither constructor below needs a cast; its only job is to make
 * the two mutually unassignable. `scope.test-d.ts` fails without it.
 */
export type InboxWriteScope = {
  organizationId: string | null
  userId: string
  readonly __scope?: 'inboxWrite'
}

/**
 * Who can DELETE an inbox. Structurally identical to `InboxWriteScope`, and a
 * different type on purpose — see the note there.
 *
 * Deleting soft-deletes the inbox and its messages in one transaction, so the
 * data is recoverable. The address is not: `EmailInbox.email` is a plain
 * unique index rather than one partial on `deletedAt IS NULL`, because mail
 * keeps being delivered to a deleted address and freeing it would hand the
 * next claimant the previous owner's still-arriving mail. There is no restore
 * path in this codebase.
 */
export type InboxDeleteScope = {
  organizationId: string | null
  userId: string
  readonly __scope?: 'inboxDelete'
}

export type InboxDeleteScopeResult =
  | { scope: InboxDeleteScope; error?: never }
  | { scope?: never; error: Response }

export type InboxWriteScopeResult =
  | { scope: InboxWriteScope; error?: never }
  | { scope?: never; error: Response }

/**
 * The single place a principal becomes an inbox-write scope.
 *
 * The `userId` it carries differs by principal kind and both answers are
 * deliberate: a user owns what they create, and a key's writes are attributed
 * to the human who minted it. `EmailInbox.userId` is NOT NULL, so there has to
 * be an answer; the key's creator is the only party with a real claim.
 *
 * The first overload states that a user who names no organization cannot be
 * denied — the scope narrows to them alone. That keeps the dashboard's PATCH
 * free of a non-null assertion on a branch that cannot happen.
 */
export function toInboxWriteScope(principal: UserPrincipal): { scope: InboxWriteScope }
export function toInboxWriteScope(
  principal: UserPrincipal | ApiKeyPrincipal,
  requestedOrganizationId?: string | null,
): InboxWriteScopeResult
export function toInboxWriteScope(
  principal: UserPrincipal | ApiKeyPrincipal,
  requestedOrganizationId?: string | null,
): InboxWriteScopeResult {
  return resolveInboxScope(principal, requestedOrganizationId)
}

/**
 * The delete counterpart. Same resolution, different result type.
 *
 * A wrapper rather than a flag on `toInboxWriteScope`, because the whole
 * mechanism is that the two produce values a handler cannot mix up. A boolean
 * argument returning a union would put that decision back at the call site.
 */
export function toInboxDeleteScope(principal: UserPrincipal): { scope: InboxDeleteScope }
export function toInboxDeleteScope(
  principal: UserPrincipal | ApiKeyPrincipal,
  requestedOrganizationId?: string | null,
): InboxDeleteScopeResult
export function toInboxDeleteScope(
  principal: UserPrincipal | ApiKeyPrincipal,
  requestedOrganizationId?: string | null,
): InboxDeleteScopeResult {
  return resolveInboxScope(principal, requestedOrganizationId) as InboxDeleteScopeResult
}

/**
 * The one implementation both wrappers share.
 *
 * Private, so the untyped shape it returns can never reach a service — every
 * caller goes through a wrapper and gets a value the compiler can tell apart.
 */
function resolveInboxScope(
  principal: UserPrincipal | ApiKeyPrincipal,
  requestedOrganizationId?: string | null,
): InboxWriteScopeResult {
  const denied = { error: jsonError('Not authorized for this organization', 403) }

  if (principal.kind === 'apiKey') {
    if (requestedOrganizationId && requestedOrganizationId !== principal.organizationId) {
      return denied
    }
    // Always bound, never null. A key is issued for exactly one organization
    // and must not be able to write outside it, whatever its minter's other
    // memberships are.
    return { scope: { organizationId: principal.organizationId, userId: principal.userId } }
  }

  const memberOf = principal.memberships.map((m) => m.organizationId)

  if (requestedOrganizationId) {
    if (!memberOf.includes(requestedOrganizationId)) return denied
    return { scope: { organizationId: requestedOrganizationId, userId: principal.userId } }
  }

  // No organization named: the write is constrained by creator alone. This is
  // what an update from the dashboard uses, and it is exactly the authority
  // `OwnerScope` gave before. Creation refuses a null organization separately —
  // it has to know where the inbox lands.
  return { scope: { organizationId: null, userId: principal.userId } }
}
