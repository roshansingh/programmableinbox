import { z } from 'zod'
import {
  AUTOMATION_CONFIG_TYPE,
  AUTOMATION_LAYOUT_TYPE,
  AUTOMATION_LAYOUT_VERSION,
  AUTOMATION_SCHEMA_VERSION,
} from './types'

const addressListSchema = z.array(z.string().email()).min(1)
const optionalAddressListSchema = z.array(z.string().email()).optional()

const predicateSchema: z.ZodTypeAny = z
  .object({
    type: z.literal('predicate'),
    version: z.literal(1),
    field: z.enum(['from', 'to', 'cc', 'subject', 'body_text', 'header', 'has_attachment']),
    operator: z.enum(['equals', 'contains', 'starts_with', 'ends_with', 'regex', 'exists']),
    value: z.union([z.string(), z.boolean()]).optional(),
    headerName: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.field === 'header' && !value.headerName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'headerName is required for header predicates' })
    }

    if (value.field === 'has_attachment') {
      if (value.operator !== 'equals' && value.operator !== 'exists') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'has_attachment supports equals or exists only' })
      }
      if (value.operator === 'equals' && typeof value.value !== 'boolean') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'has_attachment equals requires a boolean value' })
      }
    } else if (value.operator !== 'exists' && typeof value.value !== 'string') {
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

const triggerNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('trigger'),
  version: z.literal(1),
  triggerType: z.literal('email.received'),
  config: z.object({
    type: z.literal('email_received'),
    version: z.literal(1),
  }),
})

const conditionNodeSchema = z.object({
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
  sourceHandle: z.enum(['matched', 'unmatched', 'next']).optional(),
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

    const outgoing = new Map<string, typeof config.edges>()
    for (const edge of config.edges) {
      if (!nodeMap.has(edge.sourceNodeId) || !nodeMap.has(edge.targetNodeId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `edge ${edge.id} references missing node` })
      }
      outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge])
    }

    for (const node of config.nodes) {
      const edges = outgoing.get(node.id) ?? []
      if (node.type === 'condition') {
        const matched = edges.filter((edge) => edge.sourceHandle === 'matched').length
        const unmatched = edges.filter((edge) => edge.sourceHandle === 'unmatched').length
        if (matched > 1 || unmatched > 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `condition node ${node.id} may have at most one matched and one unmatched edge` })
        }
      } else if (node.type === 'action' && edges.length > 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `action node ${node.id} may have at most one outgoing edge` })
      } else if (node.type === 'trigger' && edges.length > 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `trigger node ${node.id} may have at most one outgoing edge` })
      }
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
