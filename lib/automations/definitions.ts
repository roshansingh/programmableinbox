import {
  AUTOMATION_CONFIG_TYPE,
  AUTOMATION_LAYOUT_TYPE,
  AUTOMATION_LAYOUT_VERSION,
  AUTOMATION_SCHEMA_VERSION,
  type ActionType,
  type AutomationConfig,
  type AutomationLayout,
  type PredicateField,
} from './types'
import { actionNodeSchema, automationConfigSchema, automationLayoutSchema, conditionExprSchema } from './schemas'

export const automationDefinition = {
  key: `${AUTOMATION_CONFIG_TYPE}@${AUTOMATION_SCHEMA_VERSION}`,
  type: AUTOMATION_CONFIG_TYPE,
  version: AUTOMATION_SCHEMA_VERSION,
  label: 'Email Automation',
  schema: automationConfigSchema,
}

export const layoutDefinition = {
  key: `${AUTOMATION_LAYOUT_TYPE}@${AUTOMATION_LAYOUT_VERSION}`,
  type: AUTOMATION_LAYOUT_TYPE,
  version: AUTOMATION_LAYOUT_VERSION,
  label: 'React Flow Layout',
  schema: automationLayoutSchema,
}

export const predicateFieldDefinitions: Record<PredicateField, { label: string; description: string }> = {
  from: { label: 'From', description: 'Sender email address' },
  to: { label: 'To', description: 'To recipients' },
  cc: { label: 'CC', description: 'CC recipients' },
  subject: { label: 'Subject', description: 'Email subject line' },
  body_text: { label: 'Body', description: 'Plain-text body' },
  header: { label: 'Header', description: 'Specific message header' },
  has_attachment: { label: 'Has Attachment', description: 'Attachment presence' },
}

export const actionDefinitions: Record<
  ActionType,
  {
    key: string
    label: string
    description: string
    schema: typeof actionNodeSchema
  }
> = {
  forward_email: {
    key: 'forward_email@1',
    label: 'Forward Email',
    description: 'Forward the incoming email to one or more recipients.',
    schema: actionNodeSchema,
  },
  send_webhook: {
    key: 'send_webhook@1',
    label: 'Send Webhook',
    description: 'POST or PUT the message payload to an external endpoint.',
    schema: actionNodeSchema,
  },
  auto_reply: {
    key: 'auto_reply@1',
    label: 'Auto Reply',
    description: 'Send an automatic response from the inbox address.',
    schema: actionNodeSchema,
  },
  add_tag: {
    key: 'add_tag@1',
    label: 'Add Tag',
    description: 'Append tags to the stored email message.',
    schema: actionNodeSchema,
  },
}

export const conditionDefinition = {
  key: 'predicate_group@1',
  type: 'predicate_group',
  version: 1,
  label: 'Condition Group',
  schema: conditionExprSchema,
}

export function createDefaultAutomationConfig(): AutomationConfig {
  return {
    type: AUTOMATION_CONFIG_TYPE,
    version: AUTOMATION_SCHEMA_VERSION,
    settings: {
      priority: 100,
      stopPolicy: 'continue',
      maxActionsPerRun: 10,
      maxBranchDepth: 20,
    },
    trigger: {
      id: 'trigger_email_received',
      type: 'trigger',
      version: 1,
      triggerType: 'email.received',
      config: {
        type: 'email_received',
        version: 1,
      },
    },
    nodes: [
      {
        id: 'trigger_email_received',
        type: 'trigger',
        version: 1,
        triggerType: 'email.received',
        config: {
          type: 'email_received',
          version: 1,
        },
      },
      {
        id: 'condition_subject',
        type: 'condition',
        version: 1,
        conditionType: 'predicate_group',
        config: {
          type: 'condition_group',
          version: 1,
          groupOperator: 'all',
          children: [
            {
              type: 'predicate',
              version: 1,
              field: 'subject',
              operator: 'contains',
              value: '',
            },
          ],
        },
      },
      {
        id: 'action_webhook',
        type: 'action',
        version: 1,
        actionType: 'send_webhook',
        onError: 'stop',
        config: {
          type: 'send_webhook_config',
          version: 1,
          url: 'https://example.com/webhook',
          method: 'POST',
        },
      },
    ],
    edges: [
      {
        id: 'edge_trigger_condition',
        type: 'edge',
        version: 1,
        sourceNodeId: 'trigger_email_received',
        targetNodeId: 'condition_subject',
        sourceHandle: 'next',
      },
      {
        id: 'edge_condition_action',
        type: 'edge',
        version: 1,
        sourceNodeId: 'condition_subject',
        targetNodeId: 'action_webhook',
        sourceHandle: 'matched',
      },
    ],
  }
}

export function createDefaultAutomationLayout(config: AutomationConfig): AutomationLayout {
  const positions = Object.fromEntries(
    config.nodes.map((node, index) => [
      node.id,
      {
        x: index * 260 + 80,
        y: node.type === 'trigger' ? 120 : 180,
      },
    ])
  )

  return {
    type: AUTOMATION_LAYOUT_TYPE,
    version: AUTOMATION_LAYOUT_VERSION,
    positions,
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
  }
}
