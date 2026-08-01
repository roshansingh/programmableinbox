/**
 * User-facing text for the inbox-creation policy (issue #98).
 *
 * Kept in a module of its own, with no imports, because both sides of the
 * policy need it and they cannot share the server module: `inbox-policy.ts`
 * reads configuration through the `server-only` `lib/config`, which pulls in
 * the Pino logger — importing that from the create dialog would drag a server
 * logger into the browser bundle.
 *
 * Sharing the strings matters beyond tidiness: the client blocks a value and
 * the server independently re-blocks it, and a user who saw one wording inline
 * and a different one in a toast would reasonably think they were two different
 * problems.
 */

/**
 * Shown by the create dialog when it has no domains to offer.
 *
 * Since EMAIL_INBOX_DOMAINS became required and boot-asserted, the server
 * cannot start unconfigured — so this is reachable only before `/auth/me`
 * resolves, or if the response arrives without config. It is kept as the
 * fail-closed rendering for "we have no domain to compose an address from",
 * which must never fall back to letting the user type one.
 */
export const NOT_CONFIGURED_HINT =
  'Inbox creation is not configured — contact your administrator'

/**
 * Names the reason without echoing the blocked term. The user needs to know
 * that retrying a variant will not help; enumerating the list only helps
 * someone probing for a gap in it.
 */
export const BLOCKED_ADDRESS =
  'That address is not available — it resembles a brand or system address'

export const BLOCKED_NAME =
  'That display name is not available — it resembles a brand or system name'

export const NAME_CHARSET =
  'Display name may only contain letters, numbers, spaces and standard punctuation'

export const NAME_NOT_A_STRING = 'name must be a string'

/** Generous for a label, small enough that the column cannot be used as storage. */
export const MAX_NAME_LENGTH = 100

export const NAME_TOO_LONG = `Display name must be ${MAX_NAME_LENGTH} characters or fewer`

export const INVALID_ADDRESS = 'email must be a valid email address'

export const LOCAL_PART_REQUIRED = 'Email address is required'

export const LOCAL_PART_INVALID =
  'Use only letters, numbers and . _ % + - before the @'

/**
 * The part before the `@`, capped well below the 254-character *address* limit
 * that `lib/email-address.ts` enforces for RFC/routing reasons.
 *
 * That limit answers "can SMTP carry this"; this one answers "is this an
 * address a person would be given". Keeping it short also shrinks the room a
 * long local part offers for padding a lookalike — the blocklist matches
 * distinctive brands as substrings, so the shorter the field, the less material
 * there is to bury one in.
 */
export const MAX_LOCAL_PART_LENGTH = 50

export const LOCAL_PART_TOO_LONG = `Email address must be ${MAX_LOCAL_PART_LENGTH} characters or fewer before the @`

/** Echoes the allowed domains, which are already public config on `/auth/me`. */
export function domainNotAllowed(domains: string[]): string {
  return `Domain not allowed. Allowed domains: ${domains.join(', ')}`
}
