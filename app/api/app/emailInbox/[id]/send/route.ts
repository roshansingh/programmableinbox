import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { toOwnerScope } from '@/lib/services/scope'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { getResend } from '@/lib/resend'
import { deriveBodyText } from '@/lib/email/extract-body-text'
import logger from '@/lib/logger'

export const POST = withUser<{ id: string }>(async (request, principal, { params }) => {
  const { id } = await params

  // Owner-scoped, not organization-scoped: sending acts *as* the inbox, so it
  // is an exercise of the address rather than a read of it. An org member who
  // can see the inbox still cannot send from someone else's address.
  const owner = toOwnerScope(principal)
  const inbox = await prisma.emailInbox.findFirst({ where: { id, userId: owner.userId } })
  if (!inbox) {
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

    const { data, error } = await getResend().emails.send({
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
        // Sent mail is listed alongside received mail, so it has to be searchable
        // on the same terms (issue #106).
        bodyText: deriveBodyText({ text: text || '', html: html || '' }),
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
})
