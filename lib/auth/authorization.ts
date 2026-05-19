import { prisma } from '@/lib/db'
import { jsonError } from '@/lib/api-helpers'
import type { AuthContext } from './auth-context'

type ScopeResult = { scope: string; error?: never } | { scope?: never; error: Response }

type OrgResult = { organizationId: string; error?: never } | { organizationId?: never; error: Response }

type InboxResult =
  | { inbox: { id: string; organizationId: string; userId: string }; error?: never }
  | { inbox?: never; error: Response }

type MessageResult =
  | { message: { id: string; organizationId: string; inboxEmailAddressId: string }; error?: never }
  | { message?: never; error: Response }

export function requireScope(context: AuthContext, scope: string): ScopeResult {
  if (context.kind === 'user') {
    return { scope }
  }

  if (!context.scopes.includes(scope)) {
    return { error: jsonError(`Missing required scope: ${scope}`, 403) }
  }

  return { scope }
}

export function requireOrgAccess(context: AuthContext, organizationId: string): OrgResult {
  if (context.kind === 'user') {
    const membership = context.memberships.find(
      (item) => item.organizationId === organizationId
    )
    if (!membership) {
      return { error: jsonError('Not authorized for this organization', 403) }
    }

    return { organizationId }
  }

  if (context.organizationId !== organizationId) {
    return { error: jsonError('Not authorized for this organization', 403) }
  }

  return { organizationId }
}

export async function requireInboxAccess(
  context: AuthContext,
  inboxId: string
): Promise<InboxResult> {
  const scopeResult = requireScope(context, 'inboxes:read')
  if ('error' in scopeResult) {
    return scopeResult
  }

  const inbox = await prisma.emailInbox.findUnique({
    where: { id: inboxId },
    select: {
      id: true,
      organizationId: true,
      userId: true,
    },
  })

  if (!inbox) {
    return { error: jsonError('Inbox not found', 404) }
  }

  const orgResult = requireOrgAccess(context, inbox.organizationId)
  if ('error' in orgResult) {
    return orgResult
  }

  return { inbox }
}

export async function requireMessageAccess(
  context: AuthContext,
  messageId: string
): Promise<MessageResult> {
  const scopeResult = requireScope(context, 'messages:read')
  if ('error' in scopeResult) {
    return scopeResult
  }

  const message = await prisma.emailMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      organizationId: true,
      inboxEmailAddressId: true,
    },
  })

  if (!message) {
    return { error: jsonError('Message not found', 404) }
  }

  const orgResult = requireOrgAccess(context, message.organizationId)
  if ('error' in orgResult) {
    return orgResult
  }

  return { message }
}
