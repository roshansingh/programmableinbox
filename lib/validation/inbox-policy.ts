// Reads the environment transitively through `lib/config`, which is itself
// `server-only`, so importing this from a client component must fail the build
// rather than quietly ship server configuration to the browser. The shared
// user-facing strings live in `inbox-policy-messages.ts`, which has no imports
// and is what the create dialog uses.
import 'server-only'
import { isValidInboxAddress, splitAddress } from '@/lib/email-address'
import { config } from '@/lib/config'
import { isBlockedTerm, hasDisallowedNameCharacters } from '@/lib/security/blocked-inbox-terms'

/**
 * Inbox creation policy (issue #98), in one place because it must hold on
 * every *request-driven* write path — today the dashboard create and rename
 * routes, and any external creation endpoint added later.
 *
 * `prisma/seed.ts` and `test/integration/helpers/factories.ts` write through
 * Prisma directly and do not run this. That is deliberate — fixtures need to
 * be able to construct rows the policy forbids — but it does mean seeded data
 * is not evidence that the policy holds.
 *
 * It deliberately does not live in a route handler. A policy duplicated per
 * route is a policy that will be enforced on some routes: the original bug had
 * creation validated for syntax only, and rename validated for nothing at all,
 * so an inbox could be created as `qa` and renamed to `Amazon Support`
 * afterwards.
 *
 * Returned as data rather than thrown so callers map it to their own response
 * envelope, and so the status code is decided here — beside the reason —
 * instead of being re-guessed at each call site.
 */
export type PolicyViolation = {
  message: string
  status: number
}

/**
 * The wording lives in `inbox-policy-messages.ts` — a pure module the create
 * dialog can import too, so the inline client error and the server's rejection
 * are word-for-word the same rather than two descriptions of one rule.
 *
 * Note `BLOCKED_ADDRESS` is deliberately *not* the vague `ADDRESS_UNAVAILABLE`
 * 409 used for an already-claimed address: that one is vague to stop
 * cross-tenant address probing, whereas this rejection leaks nothing
 * tenant-specific and the user needs to know a variant will not help.
 */
import {
  BLOCKED_ADDRESS,
  BLOCKED_NAME,
  NAME_CHARSET,
  NAME_NOT_A_STRING,
  NAME_TOO_LONG,
  MAX_NAME_LENGTH,
  LOCAL_PART_TOO_LONG,
  MAX_LOCAL_PART_LENGTH,
  INVALID_ADDRESS,
  domainNotAllowed,
} from './inbox-policy-messages'

/**
 * Judges an address that has already passed `parseInboxAddress` syntax
 * validation.
 *
 * Order matters and is asserted by the tests: unconfigured first (nothing is
 * creatable, so no other answer is meaningful), then domain, then local part.
 * Checking the blocklist first would answer "is this name available on a domain
 * you cannot use anyway", which is both useless and a slightly more informative
 * oracle than necessary.
 */
export function validateInboxAddress(address: string): PolicyViolation | null {
  // Guaranteed non-empty: the `emailInbox` schema requires at least one valid
  // domain and `assertConfig()` refuses to boot without it, so there is no
  // "unconfigured" case to answer at request time. An earlier revision returned
  // 503 here; making the variable required moved that failure to boot, where a
  // misconfigured deployment is loud instead of serving a form that cannot work.
  const domains = config.emailInbox.domains

  // Re-checked here rather than assumed from the caller. Routes do run
  // `parseInboxAddress` first, but this function advertises itself to every
  // future creation path, and `splitAddress` enforces no charset — a caller
  // that trusted the docstring and skipped the syntax check would admit
  // `Аmazon@` (Cyrillic U+0410), which normalizes to `mazon` and matches no
  // term. `validateInboxName` bundles its charset guard for the same reason.
  if (!isValidInboxAddress(address)) return { message: INVALID_ADDRESS, status: 400 }

  const parts = splitAddress(address)
  if (!parts) return { message: INVALID_ADDRESS, status: 400 }

  // Compared against the list already read above rather than calling
  // isAllowedInboxDomain, which would re-parse EMAIL_INBOX_DOMAINS a second
  // time — and re-emit the malformed-entry warning on every single request.
  if (!domains.includes(parts.domain)) {
    // Safe to echo: the same list is already published to every authenticated
    // client through `GET /app/auth/me`.
    return { message: domainNotAllowed(domains), status: 400 }
  }

  // Measured on the split of the *normalized* address, so case and surrounding
  // whitespace cannot change the verdict. Deliberately tighter than the
  // 254-character address cap in `lib/email-address.ts`: that one is what SMTP
  // can route, this one is what we are willing to provision.
  if (parts.localPart.length > MAX_LOCAL_PART_LENGTH) {
    return { message: LOCAL_PART_TOO_LONG, status: 400 }
  }

  if (isBlockedTerm(parts.localPart)) {
    return { message: BLOCKED_ADDRESS, status: 422 }
  }

  return null
}

/**
 * Judges an optional display name, on create and on rename alike.
 *
 * Bundles the charset check with the term check on purpose. They answer
 * different questions, and splitting them into two exports the caller must
 * remember to run in sequence is how the Cyrillic `Аmazon` bypass gets
 * reintroduced: it normalizes to `mazon` and only the charset guard stops it.
 */
export function validateInboxName(name: unknown): PolicyViolation | null {
  if (name === undefined || name === null) return null
  if (typeof name !== 'string') return { message: NAME_NOT_A_STRING, status: 400 }

  // An empty or whitespace-only name is an absent optional field, not an
  // invalid one — the routes store it as null.
  const trimmed = name.trim()
  if (trimmed === '') return null

  // The address is capped at 254 by `lib/email-address.ts`; the name column is
  // unbounded `text` and had no equivalent, so a megabyte of `a` passed every
  // other check and would then be served on every inbox listing.
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { message: NAME_TOO_LONG, status: 400 }
  }

  if (hasDisallowedNameCharacters(trimmed)) {
    return { message: NAME_CHARSET, status: 422 }
  }

  if (isBlockedTerm(trimmed)) {
    return { message: BLOCKED_NAME, status: 422 }
  }

  return null
}
