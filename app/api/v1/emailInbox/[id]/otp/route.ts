import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params

  const inbox = await prisma.emailInbox.findFirst({
    where: {
      id,
      organizationId: { in: user.memberships.map((m) => m.organizationId) },
    },
    select: { id: true },
  })
  if (!inbox) return jsonError('Not found', 404)

  const message = await prisma.emailMessage.findFirst({
    where: {
      inboxEmailAddressId: id,
      extractedOtp: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    select: { extractedOtp: true, createdAt: true, id: true },
  })

  if (!message) return jsonError('No OTP found for this inbox', 404)

  return jsonSuccess({
    otp: message.extractedOtp as string,
    receivedAt: message.createdAt,
    messageId: message.id,
  })
}
