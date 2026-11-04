import 'server-only'
import { prisma } from '@/lib/db'
import { MAX_UNPAGINATED_ROWS } from '@/lib/pagination/params'
import type { OrgScope } from './scope'

/**
 * Only `pending` and `active` rows are visible. `released` rows are numbers we
 * no longer hold (and include every row that predates real provisioning), and
 * `failed` rows never held one; neither is something a user should see or be
 * billed a plan slot for.
 */
const LIVE = { in: ['pending', 'active'] } as const

export function listPhoneInboxes(scope: OrgScope) {
  return prisma.phoneInbox.findMany({
    where: { organizationId: { in: scope.organizationIds }, status: LIVE },
    // Deterministic order is required, not cosmetic: id breaks createdAt ties so
    // the cut is stable when the ceiling truncates.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_UNPAGINATED_ROWS,
  })
}

export function getPhoneInbox(scope: OrgScope, id: string) {
  return prisma.phoneInbox.findFirst({
    where: { id, organizationId: { in: scope.organizationIds }, status: LIVE },
  })
}

/** Plan-limit input: how many numbers an organization is holding right now. */
export function countLivePhoneInboxes(organizationId: string): Promise<number> {
  return prisma.phoneInbox.count({ where: { organizationId, status: LIVE } })
}
