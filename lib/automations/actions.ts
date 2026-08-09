import { prisma } from '@/lib/db'
import { getResend } from '@/lib/resend'
import { SsrfBlockedError, safeFetch } from '@/lib/security/ssrf-guard'
import { claimAutoReplySlot, releaseAutoReplySlot } from './auto-reply-throttle'
import { CommercialProvider } from '@/lib/commercial/provider'
import type { Automation, AutomationRevision, AutoReplyLedger, EmailInbox } from '@/lib/generated/prisma/client'
import type {
  ActionNodeConfig,
  AutomationActionResult,
  EmailAutomationInput,
} from './types'

type ActionExecutionContext = {
  automation: Pick<Automation, 'id' | 'name'>
  revision: Pick<AutomationRevision, 'id' | 'revision'>
  inbox: Pick<EmailInbox, 'id' | 'email'>
  input: EmailAutomationInput
  isDryRun: boolean
}

/**
 * The plan gate shared by every action that sends mail (issue #117 §6b).
 *
 * Returns a `skipped` result — never `failed`. A plan limit is a configuration
 * fact, not a malfunction: reporting it as a failure would mark the whole run
 * failed, mislead the operator about what went wrong, and hand the stuck-run
 * sweeper a run that behaved exactly as configured. `planLimited` in the output
 * is what lets the run log explain itself.
 *
 * Callers must invoke this *before* doing any work with a side effect — most
 * importantly before `auto_reply` claims a throttle slot, which would otherwise
 * burn a per-sender cooldown for a reply nobody receives.
 */
async function checkOutboundEmailAllowed(
  organizationId: string,
): Promise<AutomationActionResult | null> {
  const plan = await CommercialProvider.plans.resolve(organizationId)
  if (plan.limits.outboundEmail) return null

  return {
    status: 'skipped',
    output: {
      planLimited: true,
      planCode: plan.planCode,
      reason: `Outbound email is not included in the ${plan.planName} plan.`,
    },
  }
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

  const gated = await checkOutboundEmailAllowed(context.input.organizationId)
  if (gated) return gated

  const text = node.config.prependNote
    ? `${node.config.prependNote}\n\n${context.input.bodyText}`
    : context.input.bodyText

  const { data, error } = await getResend().emails.send({
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

  // Feature switch and meter, after the dry-run branch so a preview still
  // renders on a plan that cannot deliver. `skipped` rather than `failed`, for
  // the same reason as the outbound-email gate.
  const plan = await CommercialProvider.plans.resolve(context.input.organizationId)
  if (!plan.limits.outboundWebhooks) {
    return {
      status: 'skipped',
      output: {
        planLimited: true,
        planCode: plan.planCode,
        reason: `Outbound webhooks are not included in the ${plan.planName} plan.`,
      },
    }
  }

  const quota = await CommercialProvider.quota.consume(
    context.input.organizationId,
    'webhook.deliveries',
    1,
  )
  if (!quota.allowed) {
    return {
      status: 'skipped',
      output: {
        planLimited: true,
        planCode: plan.planCode,
        reason: 'Webhook delivery quota exhausted for this period.',
        limit: quota.limit,
        used: quota.used,
      },
    }
  }

  // `safeFetch` (lib/security/ssrf-guard) is used instead of global `fetch`:
  // the URL, method, headers and body of this action are all tenant-controlled,
  // so an unguarded fetch is a straight SSRF into the cloud metadata service or
  // any internal address. The guard validates the scheme/host, resolves DNS
  // itself, rejects private/loopback/link-local results, pins the socket to the
  // validated address, and re-validates every redirect hop.
  let response
  try {
    response = await safeFetch(node.config.url, {
      method: node.config.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        ...(node.config.headers ?? {}),
        ...(node.config.secret ? { 'x-inboxui-signing-secret': node.config.secret } : {}),
      },
      body: payload,
    })
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      // A blocked destination is a configuration problem, not an infrastructure
      // failure — report it as a failed action rather than throwing, so the run
      // records a usable reason and `onError` handling still applies.
      return {
        status: 'failed',
        error: {
          code: 'ssrf_blocked',
          reason: error.reason,
          detail: error.detail,
          host: error.host,
        },
      }
    }
    throw error
  }

  if (!response.ok) {
    return {
      status: 'failed',
      error: {
        status: response.status,
        // The upstream response body is deliberately NOT captured. Run records
        // are readable by the tenant, so persisting the body would turn any
        // outbound request into a readable-SSRF exfiltration channel (issue
        // #39). Status code only — truncating still leaks.
        bodyCaptured: false,
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

  // Before the throttle claim, deliberately. Claiming a slot for a reply the
  // plan forbids would burn the per-sender cooldown, so an organization that
  // upgraded would find senders throttled for replies nobody ever received.
  const gated = await checkOutboundEmailAllowed(context.input.organizationId)
  if (gated) return gated

  const throttleWindowHours = node.config.oncePerSenderWindowHours ?? 24
  const throttleKey = {
    automationId: context.automation.id,
    inboxId: context.inbox.id,
    fromEmail: context.input.from.toLowerCase(),
  }
  const claimAt = new Date()
  const cutoff = new Date(claimAt.getTime() - throttleWindowHours * 60 * 60 * 1000)

  // Dry run previews the decision without consuming the slot: a plain read of
  // the throttle window, no atomic claim and no send.
  if (context.isDryRun) {
    const existing = await findAutoReplyLedger(
      throttleKey.automationId,
      throttleKey.inboxId,
      throttleKey.fromEmail
    )
    if (existing && existing.lastSentAt.getTime() >= cutoff.getTime()) {
      return {
        status: 'skipped',
        output: { reason: 'throttled', lastSentAt: existing.lastSentAt.toISOString() },
      }
    }
    return {
      status: 'skipped',
      output: { dryRun: true, to: context.input.from },
    }
  }

  // Real run: atomically claim the slot BEFORE sending (F17). Only the winner of
  // a concurrent race proceeds; everyone else is throttled.
  const claimed = await claimAutoReplySlot(throttleKey, cutoff, claimAt)
  if (!claimed) {
    return {
      status: 'skipped',
      output: { reason: 'throttled' },
    }
  }

  const { data, error } = await getResend().emails.send({
    from: context.inbox.email,
    to: [context.input.from],
    subject: renderTemplate(node.config.subjectTemplate, context.input),
    text: renderTemplate(node.config.bodyTemplate, context.input),
  })

  if (error) {
    // The send failed, so give the slot back — a retry should be able to send.
    // Concurrent callers already lost the claim and skipped, so this can't
    // produce a duplicate.
    await releaseAutoReplySlot(throttleKey, claimAt)
    return {
      status: 'failed',
      error: { message: error.message },
    }
  }

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
