import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { jsonSuccess, jsonError, jsonPlanDenial } from '@/lib/api-helpers'
import { checkResourceLimit } from '@/lib/commercial/enforce'
import { CommercialProvider } from '@/lib/commercial/provider'
import { MAX_UNPAGINATED_ROWS } from '@/lib/pagination/params'

export const GET = withUser(async (request, principal) => {
  const organizationId = request.nextUrl.searchParams.get('organizationId')

  // The requested organization used to be applied to the query unchecked. It
  // was harmless only because the userId predicate below also constrained the
  // result — a caller could narrow to an org they did not belong to and simply
  // get nothing back. Checked properly now, so the filter cannot outlive that
  // second predicate if it is ever relaxed.
  const { error } = toOrgScope(principal, organizationId)
  if (error) return error

  // Visibility itself is unchanged: phone inboxes stay creator-scoped. This
  // task fixes the missing check, it does not widen who can see what.
  const where: { userId: string; organizationId?: string } = { userId: principal.userId }
  if (organizationId) where.organizationId = organizationId

  const inboxes = await prisma.phoneInbox.findMany({
    where,
    // Deterministic order is required, not cosmetic: without it an unordered
    // scan may return a different arbitrary subset each time the ceiling
    // truncates. id breaks createdAt ties so the cut is stable.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_UNPAGINATED_ROWS,
  })

  return jsonSuccess(inboxes)
})

export const POST = withUser(async (request, principal) => {

  try {
    const { organizationId, phoneNumber, countryCode } = await request.json()

    if (!organizationId || !phoneNumber || !countryCode) {
      return jsonError('organizationId, phoneNumber, and countryCode are required', 400)
    }

    const { error } = toOrgScope(principal, organizationId)
    if (error) return error

    // Two gates, and they answer different questions: `phoneInboxesEnabled` is
    // "does this plan have the feature at all", `phoneInboxes` is "how many".
    // Both SaaS plans currently disable the feature outright — there is no SMS
    // ingest route to meter yet — so the feature check is the one that fires.
    const plan = await CommercialProvider.plans.resolve(organizationId)
    if (!plan.limits.phoneInboxesEnabled) {
      return jsonPlanDenial({
        message: `Phone inboxes are not included in your ${plan.planName} plan.`,
        status: 402,
        limit: 0,
        used: 0,
        planCode: plan.planCode,
      })
    }

    const denial = await checkResourceLimit(organizationId, 'phoneInboxes', 'phone inbox', () =>
      prisma.phoneInbox.count({ where: { organizationId } }),
    )
    if (denial) return jsonPlanDenial(denial)

    const inbox = await prisma.phoneInbox.create({
      data: {
        organizationId,
        userId: principal.userId,
        phoneNumber,
        countryCode,
      },
    })

    return jsonSuccess(inbox, 201)
  } catch {
    return jsonError('Internal server error', 500)
  }
})
