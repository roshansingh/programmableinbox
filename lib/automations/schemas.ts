import { z } from 'zod'
import {
  AUTOMATION_CONFIG_TYPE,
  AUTOMATION_LAYOUT_TYPE,
  AUTOMATION_LAYOUT_VERSION,
  AUTOMATION_SCHEMA_VERSION,
} from './types'

const addressListSchema = z.array(z.string().email()).min(1, { message: 'At least one recipient is required' })
const optionalAddressListSchema = z.array(z.string().email()).optional()

const predicateSchema: z.ZodTypeAny = z
  .object({
    type: z.literal('predicate'),
    version: z.literal(1),
    field: z.enum(['from', 'to', 'cc', 'subject', 'body_text', 'header', 'has_attachment']),
    operator: z.enum([
      'equals',
      'not_equals',
      'contains',
      'not_contains',
      'starts_with',
      'ends_with',
      'regex',
      'exists',
      'not_exists',
    ]),
    value: z.union([z.string(), z.boolean()]).optional(),
    headerName: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.field === 'header' && !value.headerName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'headerName is required for header predicates' })
    }

    if (value.field === 'has_attachment') {
      if (!['equals', 'not_equals', 'exists', 'not_exists'].includes(value.operator)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'has_attachment supports equals, not_equals, exists, or not_exists only',
        })
      }
      if (
        (value.operator === 'equals' || value.operator === 'not_equals') &&
        typeof value.value !== 'boolean'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'has_attachment equals and not_equals require a boolean value',
        })
      }
    } else if (
      value.operator !== 'exists' &&
      value.operator !== 'not_exists' &&
      typeof value.value !== 'string'
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'string predicates require a string value' })
    }

    if (value.operator === 'regex' && typeof value.value === 'string') {
      try {
        new RegExp(value.value)
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'regex must be valid' })
      }
    }
  })

export const conditionExprSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('condition_group'),
      version: z.literal(1),
      groupOperator: z.enum(['all', 'any']),
      children: z.array(conditionExprSchema).min(1),
    }),
    predicateSchema,
  ])
)

export const triggerNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('trigger'),
  version: z.literal(1),
  triggerType: z.literal('email.received'),
  config: z.object({
    type: z.literal('email_received'),
    version: z.literal(1),
  }),
})

export const conditionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('condition'),
  version: z.literal(1),
  conditionType: z.literal('predicate_group'),
  config: conditionExprSchema,
})

const forwardEmailActionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('action'),
  version: z.literal(1),
  actionType: z.literal('forward_email'),
  onError: z.enum(['stop', 'continue']).optional(),
  config: z.object({
    type: z.literal('forward_email_config'),
    version: z.literal(1),
    to: addressListSchema,
    cc: optionalAddressListSchema,
    bcc: optionalAddressListSchema,
    includeAttachments: z.boolean().optional(),
    prependNote: z.string().optional(),
  }),
})

const sendWebhookActionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('action'),
  version: z.literal(1),
  actionType: z.literal('send_webhook'),
  onError: z.enum(['stop', 'continue']).optional(),
  config: z.object({
    type: z.literal('send_webhook_config'),
    version: z.literal(1),
    url: z.string().url(),
    method: z.enum(['POST', 'PUT']).optional(),
    headers: z.record(z.string()).optional(),
    bodyTemplate: z.string().optional(),
    secret: z.string().optional(),
  }),
})

const autoReplyActionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('action'),
  version: z.literal(1),
  actionType: z.literal('auto_reply'),
  onError: z.enum(['stop', 'continue']).optional(),
  config: z.object({
    type: z.literal('auto_reply_config'),
    version: z.literal(1),
    subjectTemplate: z.string().min(1),
    bodyTemplate: z.string().min(1),
    oncePerSenderWindowHours: z.number().int().positive().optional(),
  }),
})

const addTagActionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('action'),
  version: z.literal(1),
  actionType: z.literal('add_tag'),
  onError: z.enum(['stop', 'continue']).optional(),
  config: z.object({
    type: z.literal('add_tag_config'),
    version: z.literal(1),
    tags: z.array(z.string().trim().min(1)).min(1),
  }),
})

export const actionNodeSchema = z.union([
  forwardEmailActionNodeSchema,
  sendWebhookActionNodeSchema,
  autoReplyActionNodeSchema,
  addTagActionNodeSchema,
])

export const automationNodeSchema = z.union([
  triggerNodeSchema,
  conditionNodeSchema,
  actionNodeSchema,
])

export const automationEdgeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('edge'),
  version: z.literal(1),
  sourceNodeId: z.string().min(1),
  sourceHandle: z.literal('next').optional(),
  targetNodeId: z.string().min(1),
})

export const automationConfigSchema = z
  .object({
    type: z.literal(AUTOMATION_CONFIG_TYPE),
    version: z.literal(AUTOMATION_SCHEMA_VERSION),
    settings: z.object({
      priority: z.number().int().min(0),
      stopPolicy: z.enum(['continue', 'stop_after_match']),
      maxActionsPerRun: z.number().int().positive().optional(),
      maxBranchDepth: z.number().int().positive().optional(),
    }),
    trigger: triggerNodeSchema,
    nodes: z.array(automationNodeSchema).min(1),
    edges: z.array(automationEdgeSchema),
  })
  .superRefine((config, ctx) => {
    const nodeMap = new Map(config.nodes.map((node) => [node.id, node]))
    const triggerNodes = config.nodes.filter((node) => node.type === 'trigger')

    if (triggerNodes.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'exactly one trigger node is required' })
    }

    if (!nodeMap.has(config.trigger.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'top-level trigger must exist in nodes' })
    }

    const incoming = new Map<string, typeof config.edges>()
    const outgoing = new Map<string, typeof config.edges>()
    const seenEdgeKeys = new Set<string>()

    for (const edge of config.edges) {
      const source = nodeMap.get(edge.sourceNodeId)
      const target = nodeMap.get(edge.targetNodeId)

      if (!source || !target) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `edge ${edge.id} references missing node` })
        continue
      }

      if (edge.sourceNodeId === edge.targetNodeId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `edge ${edge.id} may not be a self-loop` })
      }

      const duplicateKey = `${edge.sourceNodeId}:${edge.targetNodeId}:${edge.sourceHandle ?? 'next'}`
      if (seenEdgeKeys.has(duplicateKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `edge ${edge.id} duplicates an existing connection`,
        })
      }
      seenEdgeKeys.add(duplicateKey)

      const allowed =
        (source.type === 'trigger' && (target.type === 'condition' || target.type === 'action')) ||
        (source.type === 'condition' && (target.type === 'condition' || target.type === 'action'))

      if (!allowed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `invalid connection ${source.id} -> ${target.id}`,
        })
      }

      outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge])
      incoming.set(edge.targetNodeId, [...(incoming.get(edge.targetNodeId) ?? []), edge])
    }

    const reachable = new Set<string>()
    const queue = [config.trigger.id]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current || reachable.has(current)) continue
      reachable.add(current)
      for (const edge of outgoing.get(current) ?? []) {
        queue.push(edge.targetNodeId)
      }
    }

    for (const node of config.nodes) {
      if (node.type === 'trigger' && (incoming.get(node.id)?.length ?? 0) > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `trigger node ${node.id} cannot have incoming edges`,
        })
      }

      if (node.type === 'action' && (outgoing.get(node.id)?.length ?? 0) > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `action node ${node.id} cannot have outgoing edges`,
        })
      }

      if (!reachable.has(node.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `node ${node.id} is disconnected` })
      }
    }

    const hasReachableAction = config.nodes.some(
      (node) => node.type === 'action' && reachable.has(node.id)
    )
    if (!hasReachableAction) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at least one reachable action is required from the trigger',
      })
    }
  })

export const automationLayoutSchema = z.object({
  type: z.literal(AUTOMATION_LAYOUT_TYPE),
  version: z.literal(AUTOMATION_LAYOUT_VERSION),
  positions: z.record(
    z.object({
      x: z.number(),
      y: z.number(),
    })
  ),
  viewport: z
    .object({
      x: z.number(),
      y: z.number(),
      zoom: z.number(),
    })
    .optional(),
})

export type AutomationConfigInput = z.infer<typeof automationConfigSchema>
export type AutomationLayoutInput = z.infer<typeof automationLayoutSchema>
