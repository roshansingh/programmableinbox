import { AutomationRunStatus } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/db'
import { executeAutomation } from './executor'
import { parseAutomationConfig } from './serialization'

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

export async function replayAutomationRun(runId: string) {
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
    isDryRun: run.isDryRun,
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
