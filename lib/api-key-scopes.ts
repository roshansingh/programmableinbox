/**
 * Every scope names its domain. `PhoneInbox` is already in the schema with its
 * own internal route tree, so an unprefixed `inboxes:read` had exactly two
 * futures once SMS reached the external surface: silently widen to grant phone
 * inboxes as well, or be renamed then instead — the same break, with more keys
 * in the wild. The MCP tool names already made this call (`pibx_email_*`);
 * these are the last identifiers that hadn't.
 *
 * The three mutating scopes are deliberately granular rather than one
 * `email_inboxes:write`. They do not cost the same to get wrong: creating and
 * renaming an inbox are recoverable, while deleting one permanently consumes
 * its address. `EmailInbox.email` is a plain unique index — not partial on
 * `deletedAt IS NULL` — because DNS keeps delivering to a deleted address, so
 * freeing it would hand the next claimant the previous owner's still-arriving
 * mail. The row is soft-deleted and recoverable; the address is not.
 *
 * Bundling them would mean the grant needed to provision a throwaway inbox
 * also carried the one irreversible operation on this surface.
 */
export const API_KEY_SCOPES = [
  'email_inboxes:read',
  'email_messages:read',
  'email_inboxes:create',
  'email_inboxes:update',
  'email_inboxes:delete',
] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

/**
 * Enumerated explicitly rather than spread from API_KEY_SCOPES. The spread is
 * how the previous default came to include `messages:delete` — a scope added
 * for one purpose silently became a default grant for every new key. That is
 * no longer hypothetical: three mutating scopes sit in the list above, and a
 * spread here would hand every new key the ability to claim and destroy
 * addresses on our domains without anyone choosing it.
 */
export const DEFAULT_API_KEY_SCOPES: ApiKeyScope[] = ['email_inboxes:read', 'email_messages:read']

export const API_KEY_SCOPE_SET = new Set<string>(API_KEY_SCOPES)

/**
 * What each scope actually grants, in the words a person choosing one needs.
 *
 * Three bare `email_*` strings side by side give no signal that one of them
 * provisions addresses on domains we own while the other two only read. The
 * dashboard renders these next to the checkboxes.
 */
export const API_KEY_SCOPE_DESCRIPTIONS: Record<ApiKeyScope, string> = {
  'email_inboxes:read': 'List and read email inboxes.',
  'email_messages:read': 'Read messages, search them, and retrieve one-time codes.',
  'email_inboxes:create': 'Claim new inbox addresses on your domains.',
  'email_inboxes:update': 'Rename inboxes. The address itself can never be changed.',
  'email_inboxes:delete':
    'Delete inboxes and their messages. The address is retired permanently and can never be claimed again, including by you.',
}

/**
 * Scopes the dashboard ticks alongside a chosen one.
 *
 * A UI affordance, not an implication: the server grants exactly the scopes
 * stored on the key, so the effective grant of a ticked box always equals its
 * label. But a key that can create an inbox and cannot list what it created is
 * a strange object, so the dialog picks the read scope up rather than leaving
 * the user to discover the gap after minting a key they cannot change.
 */
export const IMPLIED_IN_UI: Partial<Record<ApiKeyScope, readonly ApiKeyScope[]>> = {
  'email_inboxes:create': ['email_inboxes:read'],
  'email_inboxes:update': ['email_inboxes:read'],
  'email_inboxes:delete': ['email_inboxes:read'],
}

/**
 * Retired scope names, mapped onto their replacements.
 *
 * Scope checks compare a route's declared scopes against strings read from
 * `api_keys.scopes`, and the migration that rewrites those rows does not land
 * atomically with the deploy that renames the declarations. Without this map
 * every external request in that window fails 403 `Missing required scope`,
 * which reads to a customer as "my key broke" rather than "a deploy is in
 * flight".
 *
 * Deliberately read-only aliases. A legacy name must never resolve onto a
 * mutating scope — a rename is not a privilege grant, and the whole point of
 * the mutating scopes is that each can only be held by having been chosen.
 *
 * Delete this map, `resolveScope`, and their call sites one release after the
 * migration has run.
 */
export const LEGACY_SCOPE_ALIASES: Record<string, ApiKeyScope> = {
  'inboxes:read': 'email_inboxes:read',
  'messages:read': 'email_messages:read',
}

/**
 * Normalizes one stored scope string to its current name.
 *
 * Unrecognized values pass through untouched rather than being dropped or
 * defaulted. A scope this code does not know about satisfies nothing, which is
 * the correct outcome — mapping it to something would be inventing a grant.
 */
export function resolveScope(scope: string): string {
  return LEGACY_SCOPE_ALIASES[scope] ?? scope
}

/**
 * Credential discrimination depends on this being the sole source of truth.
 * Adding a `sk_test_` tier later is a single-site change here plus the
 * corresponding branch in `lib/auth/with-auth.ts`.
 */
export const API_KEY_PREFIX = 'sk_live_'
