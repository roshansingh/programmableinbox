import { AutomationRunStatus, Prisma } from '@/lib/generated/prisma/client'
import { prisma as db } from '@/lib/db'
import type { Automation, AutomationRevision, EmailInbox, EmailMessage } from '@/lib/generated/prisma/client'
import { evaluateCondition } from './evaluator'
import { executeActionNode } from './actions'
import { parseRevisionPayload } from './serialization'
import type {
  AutomationBranchKey,
  AutomationExecutionResult,
  EmailAutomationInput,
} from './types'

type ExecuteAutomationParams = {
  automation: Pick<Automation, 'id' | 'name' | 'organizationId'>
  revision: Pick<AutomationRevision, 'id' | 'revision' | 'config' | 'layout'>
  message: Pick<
    EmailMessage,
    | 'id'
    | 'from'
    | 'to'
    | 'cc'
    | 'bcc'
    | 'subject'
    | 'text'
    | 'html'
    | 'headers'
    | 'organizationId'
    | 'inboxEmailAddressId'
    | 'tags'
  >
  inbox: Pick<EmailInbox, 'id' | 'email'>
  attachments: Array<{
    id: string
    filename: string
    contentType: string | null
    sizeBytes: number | null
  }>
  isDryRun?: boolean
}

function buildInput(params: ExecuteAutomationParams): EmailAutomationInput {
  return {
    messageId: params.message.id,
    inboxId: params.inbox.id,
    inboxEmail: params.inbox.email,
    organizationId: params.message.organizationId,
    from: params.message.from,
    to: params.message.to,
    cc: params.message.cc,
    bcc: params.message.bcc,
    subject: params.message.subject,
    bodyText: params.message.text,
    bodyHtml: params.message.html,
    headers: (params.message.headers as Record<string, string>) ?? {},
    tags: params.message.tags,
    hasAttachment: params.attachments.length > 0,
    attachments: params.attachments,
  }
}

function getOutgoingEdges(
  edgeMap: Map<string, Array<{ targetNodeId: string; sourceHandle?: string }>>,
  nodeId: string,
  branch?: AutomationBranchKey
) {
  const edges = edgeMap.get(nodeId) ?? []
  if (branch) {
    return edges.filter((edge) => edge.sourceHandle === branch)
  }
  return edges
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack }
  }
  return { message: String(error) }
}

export async function executeAutomation(params: ExecuteAutomationParams): Promise<AutomationExecutionResult> {
  const { config } = parseRevisionPayload(params.revision)
  const input = buildInput(params)
  const nodeMap = new Map(config.nodes.map((node) => [node.id, node]))
  const edgeMap = new Map<string, Array<{ targetNodeId: string; sourceHandle?: string }>>()

  for (const edge of config.edges) {
    edgeMap.set(edge.sourceNodeId, [
      ...(edgeMap.get(edge.sourceNodeId) ?? []),
      { targetNodeId: edge.targetNodeId, sourceHandle: edge.sourceHandle },
    ])
  }

  const run = await db.automationRun.create({
    data: {
      automationId: params.automation.id,
      automationRevisionId: params.revision.id,
      organizationId: params.automation.organizationId,
      emailMessageId: params.message.id,
      triggerType: config.trigger.triggerType,
      status: AutomationRunStatus.running,
      isDryRun: Boolean(params.isDryRun),
      inputSnapshot: input,
    },
  })

  const initialTargets = getOutgoingEdges(edgeMap, config.trigger.id).map((edge) => edge.targetNodeId)
  const queue = [...initialTargets]
  let matched = false
  let actionsExecuted = 0
  const maxActions = config.settings.maxActionsPerRun ?? 20
  const maxDepth = config.settings.maxBranchDepth ?? 50
  let depth = 0
  let runStatus: AutomationRunStatus = AutomationRunStatus.succeeded

  try {
    const triggerNodeRun = await db.automationNodeRun.create({
      data: {
        runId: run.id,
        configNodeId: config.trigger.id,
        configNodeType: 'trigger',
        status: AutomationRunStatus.running,
        input: input,
      },
    })

    await db.automationNodeRun.update({
      where: { id: triggerNodeRun.id },
      data: {
        status: AutomationRunStatus.succeeded,
        branchTaken: initialTargets.length > 0 ? 'next' : null,
        finishedAt: new Date(),
      },
    })

    while (queue.length > 0 && depth < maxDepth) {
      depth += 1
      const currentNodeId = queue.shift()
      if (!currentNodeId) continue
      const node = nodeMap.get(currentNodeId)
      if (!node) break

      const nodeRun = await db.automationNodeRun.create({
        data: {
          runId: run.id,
          configNodeId: node.id,
          configNodeType: node.type,
          status: AutomationRunStatus.running,
          input: input,
        },
      })

      if (node.type === 'condition') {
        const conditionMatched = evaluateCondition(node.config, input)
        matched = matched || conditionMatched
        const nextEdges = conditionMatched ? getOutgoingEdges(edgeMap, node.id, 'next') : []
        await db.automationNodeRun.update({
          where: { id: nodeRun.id },
          data: {
            status: AutomationRunStatus.succeeded,
            branchTaken: conditionMatched ? 'next' : null,
            output: { matched: conditionMatched } as Prisma.InputJsonValue,
            finishedAt: new Date(),
          },
        })
        for (const edge of nextEdges) {
          queue.push(edge.targetNodeId)
        }
        continue
      }

      matched = true
      actionsExecuted += 1
      if (actionsExecuted > maxActions) {
        runStatus = AutomationRunStatus.failed
        await db.automationNodeRun.update({
          where: { id: nodeRun.id },
          data: {
            status: AutomationRunStatus.failed,
            error: { message: 'maxActionsPerRun exceeded' },
            finishedAt: new Date(),
          },
        })
        break
      }

      const actionResult = await executeActionNode(node, {
        automation: params.automation,
        revision: params.revision,
        inbox: params.inbox,
        input,
        isDryRun: Boolean(params.isDryRun),
      })

      const nodeStatus =
        actionResult.status === 'failed'
          ? AutomationRunStatus.failed
          : actionResult.status === 'skipped'
            ? AutomationRunStatus.skipped
            : AutomationRunStatus.succeeded

      await db.automationNodeRun.update({
        where: { id: nodeRun.id },
          data: {
            status: nodeStatus,
            output: (actionResult.output ?? undefined) as Prisma.InputJsonValue | undefined,
            error: (actionResult.error ?? undefined) as Prisma.InputJsonValue | undefined,
            finishedAt: new Date(),
          },
        })

      if (actionResult.status === 'failed') {
        if (node.onError === 'continue') {
          runStatus = AutomationRunStatus.partial
        } else {
          runStatus = AutomationRunStatus.failed
          break
        }
      }
    }

    if (depth >= maxDepth) {
      runStatus = AutomationRunStatus.failed
    } else if (!matched && runStatus === AutomationRunStatus.succeeded) {
      runStatus = AutomationRunStatus.skipped
    }

    await db.automationRun.update({
      where: { id: run.id },
      data: {
        status: runStatus,
        finishedAt: new Date(),
      },
    })

    return {
      matched,
      status:
        runStatus === AutomationRunStatus.failed
          ? 'failed'
          : runStatus === AutomationRunStatus.partial
            ? 'partial'
            : runStatus === AutomationRunStatus.skipped
              ? 'skipped'
              : 'succeeded',
      runId: run.id,
    }
  } catch (error) {
    await db.automationRun.update({
      where: { id: run.id },
      data: {
        status: AutomationRunStatus.failed,
        error: serializeError(error),
        finishedAt: new Date(),
      },
    })

    throw error
  }
}
