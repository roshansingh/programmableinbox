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
export type OwnerScope = { userId: string }

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
