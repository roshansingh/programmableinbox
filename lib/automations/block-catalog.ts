import {
  GitBranch,
  Mail,
  MessageSquare,
  Tag,
  Webhook,
  type LucideIcon,
} from 'lucide-react'
import type { AutomationNodeConfig } from './types'

export type BlockKey =
  | 'condition'
  | 'forward_email'
  | 'send_webhook'
  | 'auto_reply'
  | 'add_tag'

export type BlockCatalogEntry = {
  key: BlockKey
  group: 'logic' | 'action'
  label: string
  description: string
  icon: LucideIcon
  createNode: (id: string) => AutomationNodeConfig
}

export const blockCatalog: Record<BlockKey, BlockCatalogEntry> = {
  condition: {
    key: 'condition',
    group: 'logic',
    label: 'Condition',
    description: 'Branch on properties of the incoming email.',
    icon: GitBranch,
    createNode: (id) => ({
      id,
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
    }),
  },
  forward_email: {
    key: 'forward_email',
    group: 'action',
    label: 'Forward Email',
    description: 'Forward the incoming email to one or more recipients.',
    icon: Mail,
    createNode: (id) => ({
      id,
      type: 'action',
      version: 1,
      actionType: 'forward_email',
      onError: 'stop',
      config: {
        type: 'forward_email_config',
        version: 1,
        to: [],
        includeAttachments: false,
      },
    }),
  },
  send_webhook: {
    key: 'send_webhook',
    group: 'action',
    label: 'Send Webhook',
    description: 'POST or PUT the message payload to an external endpoint.',
    icon: Webhook,
    createNode: (id) => ({
      id,
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
    }),
  },
  auto_reply: {
    key: 'auto_reply',
    group: 'action',
    label: 'Auto Reply',
    description: 'Send an automatic response from the inbox address.',
    icon: MessageSquare,
    createNode: (id) => ({
      id,
      type: 'action',
      version: 1,
      actionType: 'auto_reply',
      onError: 'stop',
      config: {
        type: 'auto_reply_config',
        version: 1,
        subjectTemplate: 'Re: {{subject}}',
        bodyTemplate: "Thanks for your message — we'll get back to you shortly.",
      },
    }),
  },
  add_tag: {
    key: 'add_tag',
    group: 'action',
    label: 'Add Tag',
    description: 'Append tags to the stored email message.',
    icon: Tag,
    createNode: (id) => ({
      id,
      type: 'action',
      version: 1,
      actionType: 'add_tag',
      onError: 'stop',
      config: {
        type: 'add_tag_config',
        version: 1,
        tags: ['tag'],
      },
    }),
  },
}

export const ALL_BLOCK_KEYS: BlockKey[] = [
  'condition',
  'forward_email',
  'send_webhook',
  'auto_reply',
  'add_tag',
]

export const blockCatalogList: BlockCatalogEntry[] = ALL_BLOCK_KEYS.map(
  (key) => blockCatalog[key]
)
