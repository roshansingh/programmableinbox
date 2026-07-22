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
 * One `@`, a non-empty local part, and a dotted domain — all without
 * whitespace or control characters. Deliberately stricter than RFC 5322: this
 * validates an address the platform is about to *receive mail at*, so anything
 * unroutable (no dot, embedded newline, spaces) is worth rejecting up front
 * rather than storing an inbox that can never match a recipient.
 */
const ADDRESS_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

/** Lowercase and trim. Idempotent. */
export function normalizeInboxAddress(raw: string): string {
  return raw.trim().toLowerCase()
}

/** True when the normalized address is a plausible, routable receiving address. */
export function isValidInboxAddress(raw: string): boolean {
  const normalized = normalizeInboxAddress(raw)
  return normalized.length > 0 && normalized.length <= MAX_ADDRESS_LENGTH && ADDRESS_PATTERN.test(normalized)
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
