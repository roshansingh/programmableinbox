import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { toOwnerScope } from '@/lib/services/scope'
import { jsonSuccess, jsonError, jsonPlanDenial } from '@/lib/api-helpers'
import { CommercialProvider } from '@/lib/commercial/provider'
import { getResend } from '@/lib/resend'
import { deriveBodyText } from '@/lib/email/extract-body-text'
import { extractLinks } from '@/lib/email/extract-links'
import { extractOtp } from '@/lib/email/extract-otp'
import { classifyLinks } from '@/lib/email/cta-heuristic'
import { findSameServiceRecipients } from '@/lib/validation/outbound-recipient-policy'
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

  // A domain we actually receive mail at is one anyone could mint an address
  // on for free by naming it as a recipient here — mail forwarded there never
  // has to leave the platform, an abuse vector plan gates and rate limits
  // don't address. Checked before the plan/quota gate below so a blocked
  // recipient never spends a paid quota unit to be told no.
  const blockedRecipients = findSameServiceRecipients([...to, ...(cc || []), ...(bcc || [])])
  if (blockedRecipients.length > 0) {
    return jsonError(
      `Cannot send to an address on this service's own domain: ${blockedRecipients.join(', ')}`,
      400,
    )
  }

  // The third outbound path, alongside `forward_email` and `auto_reply`
  // (issue #117 §6b). One switch covers all three: gating only the automated
  // ones would leave a free account able to send from a domain we own simply by
  // using the dashboard.
  const plan = await CommercialProvider.plans.resolve(inbox.organizationId)
  if (!plan.limits.outboundEmail) {
    return jsonPlanDenial({
      message: `Sending email is not included in your ${plan.planName} plan.`,
      status: 402,
      limit: 0,
      used: 0,
      planCode: plan.planCode,
    })
  }

  // Metered separately from the feature switch: a plan may allow sending and
  // still cap how much. Consumed before the send, since the unit is spent the
  // moment Resend accepts it — there is no un-sending on a later failure.
  const quota = await CommercialProvider.quota.consume(inbox.organizationId, 'emails.sent', 1, plan)
  if (!quota.allowed) {
    return jsonPlanDenial({
      message: `You have reached your ${plan.planName} plan's outbound email limit.`,
      status: 402,
      limit: quota.limit ?? 0,
      used: quota.used,
      planCode: plan.planCode,
    })
  }

  try {
    const emailHeaders: Record<string, string> = {}
    if (inReplyTo) emailHeaders['In-Reply-To'] = inReplyTo
    if (references) emailHeaders['References'] = references

    let sendResult
    try {
      sendResult = await getResend().emails.send({
        from: inbox.email,
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        text: text || undefined,
        html: html || undefined,
        headers: Object.keys(emailHeaders).length > 0 ? emailHeaders : undefined,
      })
    } catch (sendError) {
      // The SDK call itself threw rather than resolving with { error }, so
      // there is no confirmation Resend ever received the request — refund,
      // same as an explicit rejection below. Once it *has* resolved, the unit
      // is spent for real ("no un-sending on a later failure"), so nothing
      // past this point refunds on failure.
      await CommercialProvider.quota.refund(inbox.organizationId, 'emails.sent', 1, plan)
      logger.error({ inboxId: id, error: sendError }, 'Resend send threw')
      return jsonError('Failed to send email', 500)
    }
    const { data, error } = sendResult

    if (error) {
      // Resend rejected it, so nothing left the building — give the unit back
      // rather than charging for a send that did not happen.
      await CommercialProvider.quota.refund(inbox.organizationId, 'emails.sent', 1, plan)
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

    // Sent mail is listed alongside received mail, so it has to be searchable
    // and enrichment-bearing on the same terms (issue #106; deterministic
    // OTP/link extraction) — derived here rather than only on the webhook
    // ingest path (app/api/webhooks/email/route.ts), same helpers, same
    // reasoning: this data isn't gated behind the LLM plan/quota.
    const sentBodyText = deriveBodyText({ text: text || '', html: html || '' })
    const sentLinks = classifyLinks(extractLinks({ text: text || '', html: html || '' }))

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
        bodyText: sentBodyText,
        extractedOtp: extractOtp(sentBodyText),
        metadata: { links: sentLinks, timestamps: [] },
        headers: emailHeaders,
        externalId: resendId,
        inboxEmailAddressId: inbox.id,
        organizationId: inbox.organizationId,
        threadId,
        parentMessageId,
        messageId: sentMessageId,
        inReplyTo: inReplyTo || null,
        references: refsArray,
        // The sender has necessarily seen mail they just sent (issue #138) —
        // without this every outbound reply would render as unread.
        isRead: true,
      },
    })

    logger.info({ inboxId: id, resendId, threadId }, 'Email sent successfully')
    return jsonSuccess({ messageId: resendId }, 201)
  } catch (error) {
    logger.error({ inboxId: id, error }, 'Failed to send email')
    return jsonError('Failed to send email', 500)
  }
})
