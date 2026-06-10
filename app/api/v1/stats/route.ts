import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const orgIds = user.memberships.map((m) => m.organizationId)

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
}
