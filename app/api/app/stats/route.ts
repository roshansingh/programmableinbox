import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export const GET = withUser(async (request, principal) => {

  const orgIds = principal.memberships.map((m) => m.organizationId)

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [emailInboxCount, emailsTodayCount, apiKeyCount, automationCount] = await Promise.all([
    prisma.emailInbox.count({
      where: { organizationId: { in: orgIds } },
    }),
    prisma.emailMessage.count({
      where: {
        organizationId: { in: orgIds },
        createdAt: { gte: todayStart },
      },
    }),
    prisma.apiKey.count({
      where: { organizationId: { in: orgIds } },
    }),
    prisma.automation.count({
      where: {
        organizationId: { in: orgIds },
        activeRevisionId: { not: null },
      },
    }),
  ])

  return jsonSuccess({
    emailInboxes: emailInboxCount,
    emailsToday: emailsTodayCount,
    apiKeys: apiKeyCount,
    activeAutomations: automationCount,
  })
})
