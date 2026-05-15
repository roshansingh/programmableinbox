import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { Resend } from 'resend'
import { prisma } from '@/lib/db'
import { dispatchAutomationsForEmail } from '@/lib/automations/dispatcher'

const resend = new Resend(process.env.AUTH_RESEND_API_KEY)

interface WebhookEvent {
  type: string
  data: {
    email_id?: string
    [key: string]: unknown
  }
}

interface ResendEmailData {
  id: string
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text?: string
  html?: string
  headers: Record<string, string>
  created_at: string
  message_id?: string
  attachments?: Array<{
    filename?: string
    content_type?: string
    size?: number
  }>
}

/**
 * Get a header value by name, case-insensitive.
 * Email headers are case-insensitive per RFC 2822.
 */
function getHeader(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null
  const lowerName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value
  }
  return null
}

function validateSignature(
  payload: string,
  signature: string,
  timestamp: string,
): boolean {
  const webhookSecret = process.env.WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('WEBHOOK_SECRET not configured')
    return false
  }

  // Replay attack prevention (5 minute window)
  const currentTime = Math.floor(Date.now() / 1000)
  const webhookTime = parseInt(timestamp, 10)
  if (isNaN(webhookTime) || currentTime - webhookTime > 300) {
    return false
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex')

  try {
    const signatureBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')
    if (signatureBuffer.length !== expectedBuffer.length) return false
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  } catch {
    return false
  }
}

/**
 * Strip Re:/Fwd:/Fw: prefixes from a subject line to get the base subject.
 */
function normalizeSubject(subject: string): string {
  return subject.replace(/^(Re|Fwd|Fw):\s*/gi, '').trim()
}

async function determineThreading(email: ResendEmailData, dbId: string, inboxId: string) {
  // Use the top-level message_id from Resend, or the Message-ID header, or generate a fallback
  const emailMessageId = email.message_id
    || getHeader(email.headers, 'message-id')
    || `<${email.id}@inboxui.generated>`
  const storedMessageId = `${emailMessageId}::${inboxId}`
  const inReplyTo = getHeader(email.headers, 'in-reply-to')
  const referencesHeader = getHeader(email.headers, 'references') || ''
  const references = referencesHeader
    ? referencesHeader.split(/\s+/).filter(Boolean)
    : []

  // 1. Try matching by In-Reply-To / References headers
  if (inReplyTo || references.length > 0) {
    const candidates = [inReplyTo, ...references].filter(Boolean) as string[]

    for (const candidate of candidates) {
      const parentMessage = await prisma.emailMessage.findFirst({
        where: {
          inboxEmailAddressId: inboxId,
          messageId: {
            startsWith: `${candidate}::`,
          },
        },
        select: { id: true, threadId: true },
      })

      if (parentMessage) {
        return {
          threadId: parentMessage.threadId,
          parentMessageId: parentMessage.id,
          messageId: storedMessageId,
          inReplyTo,
          references,
        }
      }
    }
  }

  // 2. Fallback: match by subject within the same inbox.
  //    This catches replies where the In-Reply-To references a Message-ID we don't have
  //    (e.g. Resend assigns its own Message-ID to outgoing emails).
  const baseSubject = normalizeSubject(email.subject)
  if (baseSubject && baseSubject !== email.subject) {
    // Subject had a Re:/Fwd: prefix, so this is likely a reply
    const existingMessage = await prisma.emailMessage.findFirst({
      where: {
        inboxEmailAddressId: inboxId,
        subject: baseSubject,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, threadId: true },
    })

    if (existingMessage) {
      return {
        threadId: existingMessage.threadId,
        parentMessageId: existingMessage.id,
        messageId: storedMessageId,
        inReplyTo,
        references,
      }
    }
  }

  return {
    threadId: dbId,
    parentMessageId: null,
    messageId: storedMessageId,
    inReplyTo: null,
    references: [] as string[],
  }
}

async function storeIncomingEmail(resendEmail: ResendEmailData) {
  const allAddresses = [
    ...resendEmail.to,
    ...(resendEmail.cc || []),
    ...(resendEmail.bcc || []),
  ].map((e) => e.toLowerCase().trim())

  const matchingInboxes = await prisma.emailInbox.findMany({
    where: { email: { in: allAddresses } },
  })

  if (matchingInboxes.length === 0) {
    console.log(`No matching inboxes for email ${resendEmail.id}`, { addresses: allAddresses })
    return []
  }

  const created = []

  for (const inbox of matchingInboxes) {
    try {
      const messageId = crypto.randomUUID()
      const threading = await determineThreading(resendEmail, messageId, inbox.id)

      const message = await prisma.emailMessage.create({
        data: {
          id: messageId,
          from: resendEmail.from,
          to: resendEmail.to,
          cc: resendEmail.cc || [],
          bcc: resendEmail.bcc || [],
          subject: resendEmail.subject,
          text: resendEmail.text || '',
          html: resendEmail.html || '',
          headers: resendEmail.headers || {},
          externalId: resendEmail.id,
          inboxEmailAddressId: inbox.id,
          organizationId: inbox.organizationId,
          threadId: threading.threadId,
          parentMessageId: threading.parentMessageId,
          messageId: threading.messageId,
          inReplyTo: threading.inReplyTo,
          references: threading.references,
        },
      })

      if (resendEmail.attachments?.length) {
        await prisma.emailAttachment.createMany({
          data: resendEmail.attachments.map((attachment) => ({
            emailMessageId: message.id,
            filename: attachment.filename || 'attachment',
            contentType: attachment.content_type || null,
            sizeBytes: attachment.size || null,
          })),
        })
      }

      created.push(message)
    } catch (error: any) {
      // Skip duplicates
      if (error.code === 'P2002' && error.meta?.target?.includes('externalId')) {
        console.log(`Duplicate email for inbox ${inbox.email}: ${resendEmail.id}`)
        continue
      }
      console.error(`Failed to store for inbox ${inbox.email}:`, error)
    }
  }

  return created
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-webhook-signature')
  const timestamp = request.headers.get('x-webhook-timestamp')

  if (!signature || !timestamp) {
    console.warn('Webhook received without required signature headers')
    return NextResponse.json({ message: 'Missing webhook signature' }, { status: 401 })
  }

  if (!validateSignature(rawBody, signature, timestamp)) {
    console.warn('Invalid webhook signature')
    return NextResponse.json({ message: 'Invalid webhook signature' }, { status: 401 })
  }

  const event: WebhookEvent = JSON.parse(rawBody)

  if (event.type !== 'email.received' || !event.data.email_id) {
    return NextResponse.json({ message: 'Webhook received' })
  }

  try {
    const { data: email } = await resend.emails.receiving.get(event.data.email_id)

    if (!email) {
      console.warn('Email not found for ID:', event.data.email_id)
      return NextResponse.json({ message: 'Webhook received' })
    }

    const resendEmail: ResendEmailData = {
      id: event.data.email_id,
      from: email.from,
      to: email.to || [],
      cc: email.cc || [],
      bcc: email.bcc || [],
      subject: email.subject || '',
      text: email.text || '',
      html: email.html || '',
      headers: email.headers || {},
      created_at: email.created_at || new Date().toISOString(),
      message_id: (email as any).message_id,
      attachments: Array.isArray((email as any).attachments)
        ? (email as any).attachments
        : [],
    }

    const stored = await storeIncomingEmail(resendEmail)
    await Promise.all(stored.map((message) => dispatchAutomationsForEmail(message.id)))
    console.log(`Stored ${stored.length} message(s) for email ${event.data.email_id}`)
  } catch (error) {
    console.error('Failed to process email webhook:', error)
    return NextResponse.json({ message: 'Webhook processing failed' }, { status: 500 })
  }

  return NextResponse.json({ message: 'Webhook received' })
}
