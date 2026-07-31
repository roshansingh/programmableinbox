import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { getInbox } from '@/lib/services/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export const GET = withUser<{ id: string }>(async (_request, principal, { params }) => {
  const { id } = await params

  // A read, so organization-scoped — matching what this route already did by
  // hand with the membership org list.
  const { scope, error } = toOrgScope(principal)
  if (error) return error

  const inbox = await getInbox(scope, id)
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
})
