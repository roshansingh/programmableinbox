import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { Resend } from 'resend'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import logger from '@/lib/logger'

const resend = new Resend(process.env.AUTH_RESEND_API_KEY)

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params

  const inbox = await prisma.emailInbox.findUnique({ where: { id } })
  if (!inbox || inbox.userId !== user.id) {
    return jsonError('Not found', 404)
  }

  const { to, cc, bcc, subject, text, html, inReplyTo, references } = await request.json()

  if (!to || !Array.isArray(to) || to.length === 0) {
    return jsonError('At least one recipient (to) is required', 400)
  }
  if (!subject) {
    return jsonError('Subject is required', 400)
  }
  if (!text && !html) {
    return jsonError('Message body (text or html) is required', 400)
  }

  try {
    const emailHeaders: Record<string, string> = {}
    if (inReplyTo) emailHeaders['In-Reply-To'] = inReplyTo
    if (references) emailHeaders['References'] = references

    const { data, error } = await resend.emails.send({
      from: inbox.email,
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject,
      text: text || undefined,
      html: html || undefined,
      headers: Object.keys(emailHeaders).length > 0 ? emailHeaders : undefined,
    })

    if (error) {
      logger.error({ inboxId: id, error }, 'Resend send error')
      return jsonError(error.message || 'Failed to send email', 500)
    }

    // Store the sent email in the database for thread continuity
    const resendId = data?.id || crypto.randomUUID()
    const dbMessageId = crypto.randomUUID()
    const refsArray = references ? references.split(/\s+/).filter(Boolean) : []

    // Determine threading — find parent message to join existing thread
    let threadId: string = dbMessageId
    let parentMessageId: string | null = null

    if (inReplyTo) {
      const parentMessage = await prisma.emailMessage.findFirst({
        where: { messageId: inReplyTo },
        select: { id: true, threadId: true },
      })
      if (parentMessage) {
        threadId = parentMessage.threadId
        parentMessageId = parentMessage.id
      }
    }

    // Generate a stable Message-ID for this sent email so replies can reference it
    const sentMessageId = `<${resendId}@${inbox.email.split('@')[1]}>`

    await prisma.emailMessage.create({
      data: {
        id: dbMessageId,
        from: inbox.email,
        to,
        cc: cc || [],
        bcc: bcc || [],
        subject,
        text: text || '',
        html: html || '',
        headers: emailHeaders,
        externalId: resendId,
        inboxEmailAddressId: inbox.id,
        organizationId: inbox.organizationId,
        threadId,
        parentMessageId,
        messageId: sentMessageId,
        inReplyTo: inReplyTo || null,
        references: refsArray,
      },
    })

    logger.info({ inboxId: id, resendId, threadId }, 'Email sent successfully')
    return jsonSuccess({ messageId: resendId }, 201)
  } catch (error) {
    logger.error({ inboxId: id, error }, 'Failed to send email')
    return jsonError('Failed to send email', 500)
  }
}
