// Server-only business rule, kept out of `schemas.ts`/`validation.ts` — those
// two are shared with the client-side automation editor (see their own
// docstrings), so they cannot import `@/lib/config` without breaking the
// browser bundle. This module is imported only by the save routes.
import 'server-only'
import { findSameServiceRecipients } from '@/lib/validation/outbound-recipient-policy'
import type { AutomationConfig } from './types'

export type ForwardEmailDomainViolation = {
  nodeId: string
  addresses: string[]
}

/**
 * `forward_email` nodes whose `to`/`cc`/`bcc` name an address on a domain
 * this deployment owns (`EMAIL_INBOX_ALLOWED_DOMAINS`) — forwarding there
 * never leaves the platform, minting a free address or looping mail back
 * into our own inbound pipeline.
 */
export function findForwardEmailDomainViolations(config: AutomationConfig): ForwardEmailDomainViolation[] {
  const violations: ForwardEmailDomainViolation[] = []

  for (const node of config.nodes) {
    if (node.type !== 'action' || node.actionType !== 'forward_email') continue

    const addresses = [...node.config.to, ...(node.config.cc ?? []), ...(node.config.bcc ?? [])]
    const blocked = findSameServiceRecipients(addresses)
    if (blocked.length > 0) {
      violations.push({ nodeId: node.id, addresses: blocked })
    }
  }

  return violations
}
