import { prisma } from '@/lib/db'
import { withApiKey } from '@/lib/auth/with-auth'
import { toOrgScope } from '@/lib/services/scope'
import { getInbox } from '@/lib/services/email-inbox'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

// A read of extracted message content, so it takes email_messages:read rather
// than email_inboxes:read — matching the MCP tool's pibx_email_get_latest_otp,
// which reads the same field under the same scope.
export const GET = withApiKey<{ id: string }>(
  { scopes: ['email_messages:read'] },
  async (_request, principal, { params }) => {
    const { id } = await params

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
  },
)
