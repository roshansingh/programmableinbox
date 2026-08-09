import { AutomationRunStatus } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/db'
import { executeAutomation } from './executor'
import { parseAutomationConfig } from './serialization'
import { CommercialProvider } from '@/lib/commercial/provider'

async function loadMessageContext(messageId: string) {
  return prisma.emailMessage.findUnique({
    where: { id: messageId },
    include: {
      inboxEmailAddress: true,
      attachments: true,
    },
  })
}

export async function dispatchAutomationsForEmail(messageId: string) {
  const message = await loadMessageContext(messageId)
  if (!message) return []

  // Before the automation query, not after: a plan without automations should
  // not pay to look them up on every inbound message.
  const plan = await CommercialProvider.plans.resolve(message.organizationId)
  if (!plan.limits.automationsEnabled) return []

  const automations = await prisma.automation.findMany({
    where: {
      organizationId: message.organizationId,
      isActive: true,
      OR: [{ inboxId: null }, { inboxId: message.inboxEmailAddressId }],
      activeRevisionId: { not: null },
    },
    include: {
      activeRevision: true,
    },
  })

  const sorted = automations
    .filter((automation) => automation.activeRevision)
    .map((automation) => ({
      automation,
      config: parseAutomationConfig(automation.activeRevision!.config),
    }))
    .sort((left, right) => left.config.settings.priority - right.config.settings.priority)

  const results = []
  for (const entry of sorted) {
    // Metered per automation rather than per message: one inbound email can
    // trigger several, and each is a separate unit of work. Consuming here
    // rather than inside the executor keeps the meter next to the decision to
    // run, so a plan that runs out mid-fan-out stops cleanly.
    const quota = await CommercialProvider.quota.consume(
      message.organizationId,
      'automation.runs',
      1,
      plan,
    )
    if (!quota.allowed) break

    const result = await executeAutomation({
      automation: entry.automation,
      revision: entry.automation.activeRevision!,
      message,
      inbox: message.inboxEmailAddress,
      attachments: message.attachments,
    })
    results.push(result)
    if (result.matched && entry.config.settings.stopPolicy === 'stop_after_match') {
      break
    }
  }

  return results
}

export async function runAutomationDryRun(automationId: string, limit = 50) {
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    include: { activeRevision: true, inbox: true },
  })

  if (!automation || !automation.activeRevision) {
    throw new Error('Automation not found or has no active revision')
  }

  const messageWhere = automation.inboxId
    ? { inboxEmailAddressId: automation.inboxId }
    : { organizationId: automation.organizationId }

  const messages = await prisma.emailMessage.findMany({
    where: messageWhere,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      inboxEmailAddress: true,
      attachments: true,
    },
  })

  const results = []
  for (const message of messages) {
    results.push(
      await executeAutomation({
        automation,
        revision: automation.activeRevision,
        message,
        inbox: message.inboxEmailAddress,
        attachments: message.attachments,
        isDryRun: true,
      })
    )
  }

  return results
}

/**
 * Re-executes a stored run.
 *
 * `isDryRun` is a REQUIRED argument and is never derived from the stored run
 * (security issue #40). Inheriting `run.isDryRun` meant that replaying any run
 * that was originally live silently re-fired its real side effects — outbound
 * webhook `fetch`es, forwarded email, auto-replies — with no confirmation and
 * no ceiling. Callers must state their intent; the HTTP layer defaults to a dry
 * run and only passes `false` when the request carries an explicit confirmation.
 */
export async function replayAutomationRun(runId: string, options: { isDryRun: boolean }) {
  const run = await prisma.automationRun.findUnique({
    where: { id: runId },
    include: {
      automation: true,
      automationRevision: true,
      emailMessage: {
        include: {
          inboxEmailAddress: true,
          attachments: true,
        },
      },
    },
  })

  if (!run || !run.emailMessage) {
    throw new Error('Automation run not found or missing email message')
  }

  return executeAutomation({
    automation: run.automation,
    revision: run.automationRevision,
    message: run.emailMessage,
    inbox: run.emailMessage.inboxEmailAddress,
    attachments: run.emailMessage.attachments,
    isDryRun: options.isDryRun,
  })
}

export async function markStuckAutomationRuns(staleBefore: Date) {
  return prisma.automationRun.updateMany({
    where: {
      status: {
        in: [AutomationRunStatus.queued, AutomationRunStatus.running],
      },
      startedAt: {
        lt: staleBefore,
      },
    },
    data: {
      status: AutomationRunStatus.failed,
      error: { message: 'Marked failed by stuck-run sweeper' },
      finishedAt: new Date(),
    },
  })
}
