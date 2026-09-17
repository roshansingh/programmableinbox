// Reads the environment transitively through `lib/config`, which is itself
// `server-only`, so importing this from a client component must fail the
// build rather than quietly ship server configuration to the browser.
import 'server-only'
import { splitAddress } from '@/lib/email-address'
import { config } from '@/lib/config'

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
 */
export function isSameServiceRecipient(address: string): boolean {
  const parts = splitAddress(address)
  if (!parts) return false
  return config.emailInbox.domains.includes(parts.domain)
}

/** The subset of `addresses` that resolve to a domain this deployment owns. */
export function findSameServiceRecipients(addresses: readonly string[]): string[] {
  return addresses.filter(isSameServiceRecipient)
}
