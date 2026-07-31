import { NextRequest } from 'next/server'
import { jsonError } from '@/lib/api-helpers'
import { toOrgScope } from '@/lib/services/scope'
import type { UserPrincipal } from '@/lib/auth/principals'
import { prisma } from '@/lib/db'
import { compileAutomationGraph } from '@/lib/automations/graph'
import { parseRevisionPayload } from '@/lib/automations/serialization'
import { validateAutomationGraph } from '@/lib/automations/validation'
import type { Automation, AutomationRevision } from '@/lib/generated/prisma/client'

/**
 * These helpers take the principal withUser resolves, not a Prisma user. Both
 * carry `memberships`, so the membership-shaped logic below is unchanged; what
 * goes away is this module doing its own authentication.
 */
type AuthenticatedUser = UserPrincipal

export type JsonObject = Record<string, unknown>

export function requireOrganizationMembership(
  user: AuthenticatedUser,
  organizationId: string | null | undefined
): { organizationId: string; error?: never } | { organizationId?: never; error: Response } {
  if (!organizationId) {
    return { error: jsonError('organizationId is required', 400) }
  }

  // The membership decision itself lives in toOrgScope, so every tree answers
  // it the same way. The 400 above stays here because it is a request-shape
  // check, not an authorization one — toOrgScope treats a missing id as
  // "no narrowing" rather than an error.
  const { error } = toOrgScope(user, organizationId)
  if (error) return { error }

  return { organizationId }
}

export async function readJsonObject(request: NextRequest): Promise<
  { body: JsonObject; error?: never } | { body?: never; error: Response }
> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { error: jsonError('Request body must be a JSON object', 400) }
    }

    return { body: body as JsonObject }
  } catch {
    return { error: jsonError('Invalid JSON body', 400) }
  }
}

export function getString(body: JsonObject, key: string): string | null {
  const value = body[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function notImplemented(feature: string) {
  return jsonError(
    `Automations API placeholder: ${feature} is not implemented in this worktree yet.`,
    501
  )
}

export async function loadAutomationForUser(
  user: AuthenticatedUser,
  automationId: string
) {
  const orgIds = user.memberships.map((membership) => membership.organizationId)
  const automation = await prisma.automation.findFirst({
    where: {
      id: automationId,
      organizationId: { in: orgIds },
    },
    include: {
      activeRevision: true,
      revisions: {
        orderBy: { revision: 'desc' },
        take: 10,
      },
    },
  })

  return automation
}

export function formatAutomationRecord(
  automation: Automation & {
    activeRevision: AutomationRevision | null
    revisions?: AutomationRevision[]
  }
) {
  const revision = automation.activeRevision
  const parsed = revision ? parseRevisionPayload(revision) : null
  const graph = parsed ? compileAutomationGraph(parsed.config, parsed.layout) : { nodes: [], edges: [] }
  const validation = parsed ? validateAutomationGraph(parsed.config) : { canStart: false }

  return {
    id: automation.id,
    organizationId: automation.organizationId,
    inboxId: automation.inboxId,
    name: automation.name,
    description: automation.description,
    isActive: automation.isActive,
    status: automation.isActive ? 'active' : 'draft',
    activeRevisionId: automation.activeRevisionId,
    activeRevisionNumber: revision?.revision ?? null,
    schemaVersion: revision?.schemaVersion ?? null,
    canStart: validation.canStart,
    config: parsed?.config ?? null,
    layout: parsed?.layout ?? null,
    nodes: graph.nodes,
    edges: graph.edges,
    revisions:
      automation.revisions?.map((item) => ({
        id: item.id,
        revision: item.revision,
        schemaVersion: item.schemaVersion,
        createdAt: item.createdAt.toISOString(),
        isActive: item.id === automation.activeRevisionId,
      })) ?? [],
    createdAt: automation.createdAt.toISOString(),
    updatedAt: automation.updatedAt.toISOString(),
  }
}
