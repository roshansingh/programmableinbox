import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { Resend } from 'resend'
import { prisma } from '@/lib/db'

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

async function determineThreading(email: ResendEmailData, messageId: string) {
  const emailMessageId = email.headers?.['message-id'] || null
  const inReplyTo = email.headers?.['in-reply-to'] || null
  const referencesHeader = email.headers?.['references'] || ''
  const references = referencesHeader
    ? referencesHeader.split(/\s+/).filter(Boolean)
    : []

  if (inReplyTo || references.length > 0) {
    const parentMessageIdHeader = inReplyTo || references[0]

    const parentMessage = await prisma.emailMessage.findFirst({
      where: { messageId: parentMessageIdHeader },
      select: { id: true, threadId: true },
    })

    if (parentMessage) {
      return {
        threadId: parentMessage.threadId,
        parentMessageId: parentMessage.id,
        messageId: emailMessageId,
        inReplyTo,
        references,
      }
    }
  }

  return {
    threadId: messageId,
    parentMessageId: null,
    messageId: emailMessageId,
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
      const threading = await determineThreading(resendEmail, messageId)

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
          messageId: threading.messageId || '',
          inReplyTo: threading.inReplyTo,
          references: threading.references,
        },
      })

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

  // Validate signature if provided
  if (signature && timestamp) {
    if (!validateSignature(rawBody, signature, timestamp)) {
      console.warn('Invalid webhook signature')
      return NextResponse.json({ message: 'Invalid webhook signature' }, { status: 401 })
    }
  } else {
    console.warn('Webhook received without signature validation')
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
    }

    const stored = await storeIncomingEmail(resendEmail)
    console.log(`Stored ${stored.length} message(s) for email ${event.data.email_id}`)
  } catch (error) {
    console.error('Failed to process email webhook:', error)
    return NextResponse.json({ message: 'Webhook processing failed' }, { status: 500 })
  }

  return NextResponse.json({ message: 'Webhook received' })
}
