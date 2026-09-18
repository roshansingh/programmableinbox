// Reads the environment transitively through `lib/config`, which is itself
// `server-only`, so importing this from a client component must fail the
// build rather than quietly ship server configuration to the browser.
import 'server-only'
import { splitAddress } from '@/lib/email-address'
import { config } from '@/lib/config'

/**
 * Strips an RFC 5322 display name, leaving the bare addr-spec: `Support
 * <abuse@example.com>` -> `abuse@example.com`. Without this, `splitAddress`
 * (which only splits on the last `@`, not mailbox syntax) reads the domain as
 * `example.com>` — matching nothing on the allowlist and silently *bypassing*
 * the block, the worse failure direction for a security check. `from` on the
 * auto_reply path carries a raw header value, which routinely has this shape.
 */
const MAILBOX_ADDR_PATTERN = /<([^<>]+)>\s*$/

function extractMailboxAddress(raw: string): string {
  return raw.match(MAILBOX_ADDR_PATTERN)?.[1] ?? raw
}

/**
 * True when `address` resolves to a domain this deployment owns
 * (`EMAIL_INBOX_ALLOWED_DOMAINS`) — i.e. it names an inbox we could host
 * ourselves, not necessarily one that exists yet.
 *
 * Every domain on the list genuinely receives mail for us, so allowing a
 * user-controlled path (outbound send, forward, auto-reply, registration) to
 * target one is a way to mint unlimited addresses on our own domain, or to
 * loop outbound mail back into our own inbound pipeline, without going
 * through inbox-creation policy at all.
 *
 * Takes `unknown` rather than trusting its caller: `to`/`cc`/`bcc` on the
 * manual send route arrive straight from `request.json()` untyped, and a
 * non-string array entry must not reach `String.prototype.trim()` inside
 * `normalizeInboxAddress` and turn malformed client input into a 500.
 */
export function isSameServiceRecipient(address: unknown): address is string {
  if (typeof address !== 'string') return false
  const parts = splitAddress(extractMailboxAddress(address))
  if (!parts) return false
  return config.emailInbox.domains.includes(parts.domain)
}

/** The subset of `addresses` that resolve to a domain this deployment owns. */
export function findSameServiceRecipients(addresses: readonly unknown[]): string[] {
  return addresses.filter(isSameServiceRecipient)
}
