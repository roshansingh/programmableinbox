/**
 * Canonical form for inbox receiving addresses (F1 / issue #37).
 *
 * The unique index on `email_inboxes.email` is byte-exact, but inbound routing
 * lowercases the recipient before matching it
 * (`app/api/v1/webhooks/email/route.ts`). Those two must agree, or the index
 * stops being a routing guarantee: `Billing@corp.com` and `billing@corp.com`
 * are two rows to Postgres but one address to the router, so a second tenant
 * could claim the case variant of an address already in use and receive its
 * mail.
 *
 * Every write path therefore normalizes before comparing or persisting, and the
 * migration adds a CHECK constraint so a row that skipped this function cannot
 * physically exist. Normalizing here rather than case-folding the index keeps
 * `email` a plain Prisma `@unique` field — `findUnique({ where: { email } })`
 * and P2002's `meta.target` both keep working.
 *
 * SMTP local parts are technically case-sensitive (RFC 5321 §2.4), but no
 * real-world provider treats them that way, and the router already does not.
 * Consistency with the router is the security-relevant property.
 */

/** Max length of an addr-spec (RFC 5321 §4.5.3.1.3: 64 local + @ + 255 domain, capped at 254 in practice). */
const MAX_ADDRESS_LENGTH = 254

/**
 * Printable ASCII only: every character in 0x21–0x7e. Excludes space (0x20),
 * every control character, and — the point — every non-ASCII/Unicode codepoint.
 *
 * A receiving address is provisioned and then matched byte-exactly by the
 * router, so Unicode buys nothing legitimate and opens two attacks the
 * structural pattern alone lets through:
 *
 *   - Homoglyph confusables. `аdmin@corp.com` with a Cyrillic `а` (U+0430) is a
 *     different string from Latin `admin@corp.com` but visually identical, so an
 *     attacker can register a look-alike of a tenant's address. `toLowerCase()`
 *     does not fold it to ASCII, so it would otherwise be stored as-is.
 *   - Invisible characters. A zero-width space (U+200B) inside `bil​ling@corp.com`,
 *     or a non-breaking space (U+00A0), reads as an ordinary address in a UI but
 *     is a distinct row — and U+00A0 slips past the DB CHECK's POSIX
 *     `[[:space:]]`, so the app layer must be the one to reject it.
 *
 * ASCII-only makes this validator strictly at least as strong as the DB
 * constraint and removes the whole confusable surface.
 */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/

/**
 * One `@`, a non-empty local part, and a dotted domain. Deliberately stricter
 * than RFC 5322: this validates an address the platform is about to *receive
 * mail at*, so anything unroutable (no dot, embedded whitespace) is worth
 * rejecting up front rather than storing an inbox that can never match a
 * recipient. Charset is enforced separately by PRINTABLE_ASCII.
 */
const ADDRESS_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

/** Lowercase and trim. Idempotent. */
export function normalizeInboxAddress(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * True when the normalized address is a plausible, routable receiving address.
 *
 * The charset check runs on the normalized value — the form that actually gets
 * stored and compared — so the guarantee is about what lands in the database,
 * not the raw input.
 */
export function isValidInboxAddress(raw: string): boolean {
  const normalized = normalizeInboxAddress(raw)
  return (
    normalized.length > 0 &&
    normalized.length <= MAX_ADDRESS_LENGTH &&
    PRINTABLE_ASCII.test(normalized) &&
    ADDRESS_PATTERN.test(normalized)
  )
}

/**
 * Normalizes and validates a caller-supplied address in one step.
 *
 * Returns `null` for anything a route should reject with a 400, so callers
 * cannot accidentally use the raw value: the normalized address is only
 * reachable through a successful validation.
 */
export function parseInboxAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return isValidInboxAddress(raw) ? normalizeInboxAddress(raw) : null
}
