export const AUTOMATION_CONFIG_TYPE = 'email_automation'
export const AUTOMATION_LAYOUT_TYPE = 'react_flow_layout'
export const AUTOMATION_SCHEMA_VERSION = 1
export const AUTOMATION_LAYOUT_VERSION = 1

export type AutomationStopPolicy = 'continue' | 'stop_after_match'
export type AutomationNodeKind = 'trigger' | 'condition' | 'action'
export type AutomationBranchKey = 'matched' | 'unmatched' | 'next'
export type ActionErrorPolicy = 'stop' | 'continue'

export type TriggerType = 'email.received'
export type ConditionType = 'predicate_group'
export type ActionType =
  | 'forward_email'
  | 'send_webhook'
  | 'auto_reply'
  | 'add_tag'

export type PredicateField =
  | 'from'
  | 'to'
  | 'cc'
  | 'subject'
  | 'body_text'
  | 'header'
  | 'has_attachment'

export type PredicateOperator =
  | 'equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'regex'
  | 'exists'

export type ConditionExprV1 =
  | {
      type: 'condition_group'
      version: 1
      groupOperator: 'all' | 'any'
      children: ConditionExprV1[]
    }
  | {
      type: 'predicate'
      version: 1
      field: PredicateField
      operator: PredicateOperator
      value?: string | boolean
      headerName?: string
    }

export type EmailReceivedTriggerConfigV1 = {
  type: 'email_received'
  version: 1
}

export type TriggerNodeConfigV1 = {
  id: string
  type: 'trigger'
  version: 1
  triggerType: TriggerType
  config: EmailReceivedTriggerConfigV1
}

export type ConditionNodeConfigV1 = {
  id: string
  type: 'condition'
  version: 1
  conditionType: ConditionType
  config: ConditionExprV1
}

export type ForwardEmailActionConfigV1 = {
  type: 'forward_email_config'
  version: 1
  to: string[]
  cc?: string[]
  bcc?: string[]
  includeAttachments?: boolean
  prependNote?: string
}

export type SendWebhookActionConfigV1 = {
  type: 'send_webhook_config'
  version: 1
  url: string
  method?: 'POST' | 'PUT'
  headers?: Record<string, string>
  bodyTemplate?: string
  secret?: string
}

export type AutoReplyActionConfigV1 = {
  type: 'auto_reply_config'
  version: 1
  subjectTemplate: string
  bodyTemplate: string
  oncePerSenderWindowHours?: number
}

export type AddTagActionConfigV1 = {
  type: 'add_tag_config'
  version: 1
  tags: string[]
}

export type ActionNodeConfigV1 =
  | {
      id: string
      type: 'action'
      version: 1
      actionType: 'forward_email'
      onError?: ActionErrorPolicy
      config: ForwardEmailActionConfigV1
    }
  | {
      id: string
      type: 'action'
      version: 1
      actionType: 'send_webhook'
      onError?: ActionErrorPolicy
      config: SendWebhookActionConfigV1
    }
  | {
      id: string
      type: 'action'
      version: 1
      actionType: 'auto_reply'
      onError?: ActionErrorPolicy
      config: AutoReplyActionConfigV1
    }
  | {
      id: string
      type: 'action'
      version: 1
      actionType: 'add_tag'
      onError?: ActionErrorPolicy
      config: AddTagActionConfigV1
    }

export type AutomationNodeConfigV1 =
  | TriggerNodeConfigV1
  | ConditionNodeConfigV1
  | ActionNodeConfigV1

export type AutomationEdgeConfigV1 = {
  id: string
  type: 'edge'
  version: 1
  sourceNodeId: string
  sourceHandle?: AutomationBranchKey
  targetNodeId: string
}

export type AutomationConfigV1 = {
  type: typeof AUTOMATION_CONFIG_TYPE
  version: typeof AUTOMATION_SCHEMA_VERSION
  settings: {
    priority: number
    stopPolicy: AutomationStopPolicy
    maxActionsPerRun?: number
    maxBranchDepth?: number
  }
  trigger: TriggerNodeConfigV1
  nodes: AutomationNodeConfigV1[]
  edges: AutomationEdgeConfigV1[]
}

export type AutomationLayoutV1 = {
  type: typeof AUTOMATION_LAYOUT_TYPE
  version: typeof AUTOMATION_LAYOUT_VERSION
  positions: Record<string, { x: number; y: number }>
  viewport?: { x: number; y: number; zoom: number }
}

export type AutomationConfig = AutomationConfigV1
export type AutomationLayout = AutomationLayoutV1
export type AutomationNodeConfig = AutomationNodeConfigV1
export type AutomationEdgeConfig = AutomationEdgeConfigV1
export type ActionNodeConfig = ActionNodeConfigV1
export type ActionConfig =
  | ForwardEmailActionConfigV1
  | SendWebhookActionConfigV1
  | AutoReplyActionConfigV1
  | AddTagActionConfigV1

export type EmailAutomationInput = {
  messageId: string
  inboxId: string
  inboxEmail: string
  organizationId: string
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  bodyText: string
  bodyHtml: string
  headers: Record<string, string>
  tags: string[]
  hasAttachment: boolean
  attachments: Array<{
    id: string
    filename: string
    contentType: string | null
    sizeBytes: number | null
  }>
}

export type AutomationFlowNode = {
  id: string
  type: 'triggerNode' | 'conditionNode' | 'actionNode'
  position: { x: number; y: number }
  data: {
    label: string
    subtitle: string
    configNode: AutomationNodeConfig
  }
}

export type AutomationFlowEdge = {
  id: string
  source: string
  target: string
  label?: string
  sourceHandle?: string
}

export type AutomationEvaluationResult = {
  matched: boolean
  branchTaken?: AutomationBranchKey
  details?: Record<string, unknown>
}

export type AutomationActionResult = {
  status: 'succeeded' | 'failed' | 'skipped'
  output?: Record<string, unknown>
  error?: Record<string, unknown>
}

export type AutomationExecutionResult = {
  matched: boolean
  status: 'succeeded' | 'failed' | 'partial' | 'skipped'
  runId: string
}
