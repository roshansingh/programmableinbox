import { Resend } from 'resend'
import { prisma } from '@/lib/db'
import type { Automation, AutomationRevision, AutoReplyLedger, EmailInbox } from '@/lib/generated/prisma/client'
import type {
  ActionNodeConfig,
  AutomationActionResult,
  EmailAutomationInput,
} from './types'

const resend = new Resend(process.env.AUTH_RESEND_API_KEY)

type ActionExecutionContext = {
  automation: Pick<Automation, 'id' | 'name'>
  revision: Pick<AutomationRevision, 'id' | 'revision'>
  inbox: Pick<EmailInbox, 'id' | 'email'>
  input: EmailAutomationInput
  isDryRun: boolean
}

function renderTemplate(template: string, input: EmailAutomationInput) {
  return template
    .replaceAll('{{from}}', input.from)
    .replaceAll('{{subject}}', input.subject)
    .replaceAll('{{body_text}}', input.bodyText)
    .replaceAll('{{inbox_email}}', input.inboxEmail)
}

async function executeForwardEmail(
  node: Extract<ActionNodeConfig, { actionType: 'forward_email' }>,
  context: ActionExecutionContext
): Promise<AutomationActionResult> {
  if (context.isDryRun) {
    return {
      status: 'skipped',
      output: {
        dryRun: true,
        to: node.config.to,
      },
    }
  }

  const text = node.config.prependNote
    ? `${node.config.prependNote}\n\n${context.input.bodyText}`
    : context.input.bodyText

  const { data, error } = await resend.emails.send({
    from: context.inbox.email,
    to: node.config.to,
    cc: node.config.cc,
    bcc: node.config.bcc,
    subject: `Fwd: ${context.input.subject}`,
    text,
    html: context.input.bodyHtml || undefined,
  })

  if (error) {
    return {
      status: 'failed',
      error: { message: error.message },
    }
  }

  return {
    status: 'succeeded',
    output: {
      resendId: data?.id ?? null,
      includeAttachmentsRequested: Boolean(node.config.includeAttachments),
    },
  }
}

async function executeSendWebhook(
  node: Extract<ActionNodeConfig, { actionType: 'send_webhook' }>,
  context: ActionExecutionContext
): Promise<AutomationActionResult> {
  const payload = node.config.bodyTemplate
    ? renderTemplate(node.config.bodyTemplate, context.input)
    : JSON.stringify({
        automationId: context.automation.id,
        automationRevisionId: context.revision.id,
        message: context.input,
      })

  if (context.isDryRun) {
    return {
      status: 'skipped',
      output: {
        dryRun: true,
        url: node.config.url,
        method: node.config.method ?? 'POST',
      },
    }
  }

  const response = await fetch(node.config.url, {
    method: node.config.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...(node.config.headers ?? {}),
      ...(node.config.secret ? { 'x-inboxui-signing-secret': node.config.secret } : {}),
    },
    body: payload,
  })

  if (!response.ok) {
    return {
      status: 'failed',
      error: {
        status: response.status,
        body: await response.text(),
      },
    }
  }

  return {
    status: 'succeeded',
    output: {
      status: response.status,
      url: node.config.url,
    },
  }
}

async function findAutoReplyLedger(
  automationId: string,
  inboxId: string,
  fromEmail: string
): Promise<AutoReplyLedger | null> {
  return prisma.autoReplyLedger.findUnique({
    where: {
      automationId_inboxId_fromEmail: {
        automationId,
        inboxId,
        fromEmail,
      },
    },
  })
}

async function executeAutoReply(
  node: Extract<ActionNodeConfig, { actionType: 'auto_reply' }>,
  context: ActionExecutionContext
): Promise<AutomationActionResult> {
  if (context.input.from.toLowerCase() === context.inbox.email.toLowerCase()) {
    return {
      status: 'skipped',
      output: { reason: 'loop_guard_same_sender_as_inbox' },
    }
  }

  const throttleWindowHours = node.config.oncePerSenderWindowHours ?? 24
  const existing = await findAutoReplyLedger(
    context.automation.id,
    context.inbox.id,
    context.input.from.toLowerCase()
  )

  if (existing) {
    const cutoff = Date.now() - throttleWindowHours * 60 * 60 * 1000
    if (existing.lastSentAt.getTime() >= cutoff) {
      return {
        status: 'skipped',
        output: {
          reason: 'throttled',
          lastSentAt: existing.lastSentAt.toISOString(),
        },
      }
    }
  }

  if (context.isDryRun) {
    return {
      status: 'skipped',
      output: {
        dryRun: true,
        to: context.input.from,
      },
    }
  }

  const { data, error } = await resend.emails.send({
    from: context.inbox.email,
    to: [context.input.from],
    subject: renderTemplate(node.config.subjectTemplate, context.input),
    text: renderTemplate(node.config.bodyTemplate, context.input),
  })

  if (error) {
    return {
      status: 'failed',
      error: { message: error.message },
    }
  }

  await prisma.autoReplyLedger.upsert({
    where: {
      automationId_inboxId_fromEmail: {
        automationId: context.automation.id,
        inboxId: context.inbox.id,
        fromEmail: context.input.from.toLowerCase(),
      },
    },
    update: {
      lastSentAt: new Date(),
    },
    create: {
      automationId: context.automation.id,
      inboxId: context.inbox.id,
      fromEmail: context.input.from.toLowerCase(),
      lastSentAt: new Date(),
    },
  })

  return {
    status: 'succeeded',
    output: {
      resendId: data?.id ?? null,
      to: context.input.from,
    },
  }
}

async function executeAddTag(
  node: Extract<ActionNodeConfig, { actionType: 'add_tag' }>,
  context: ActionExecutionContext
): Promise<AutomationActionResult> {
  const nextTags = Array.from(new Set([...context.input.tags, ...node.config.tags]))

  if (context.isDryRun) {
    return {
      status: 'skipped',
      output: {
        dryRun: true,
        nextTags,
      },
    }
  }

  await prisma.emailMessage.update({
    where: { id: context.input.messageId },
    data: { tags: nextTags },
  })

  return {
    status: 'succeeded',
    output: { tags: nextTags },
  }
}

export async function executeActionNode(
  node: ActionNodeConfig,
  context: ActionExecutionContext
): Promise<AutomationActionResult> {
  switch (node.actionType) {
    case 'forward_email':
      return executeForwardEmail(node, context)
    case 'send_webhook':
      return executeSendWebhook(node, context)
    case 'auto_reply':
      return executeAutoReply(node, context)
    case 'add_tag':
      return executeAddTag(node, context)
  }
}
