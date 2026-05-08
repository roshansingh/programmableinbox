import { describe, expect, it } from 'vitest'
import { evaluateCondition } from '@/lib/automations/evaluator'
import type { EmailAutomationInput } from '@/lib/automations/types'

const baseInput: EmailAutomationInput = {
  messageId: 'msg_1',
  inboxId: 'inbox_1',
  inboxEmail: 'hello@example.com',
  organizationId: 'org_1',
  from: 'sender@trusted.com',
  to: ['hello@example.com'],
  cc: ['ops@example.com'],
  bcc: [],
  subject: '[support] Need help',
  bodyText: 'Please call me back',
  bodyHtml: '<p>Please call me back</p>',
  headers: {
    'x-priority': 'high',
  },
  tags: [],
  hasAttachment: true,
  attachments: [
    {
      id: 'att_1',
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    },
  ],
}

describe('evaluateCondition', () => {
  it('matches nested all-groups', () => {
    const matched = evaluateCondition(
      {
        type: 'condition_group',
        version: 1,
        groupOperator: 'all',
        children: [
          {
            type: 'predicate',
            version: 1,
            field: 'subject',
            operator: 'contains',
            value: '[support]',
          },
          {
            type: 'predicate',
            version: 1,
            field: 'from',
            operator: 'ends_with',
            value: '@trusted.com',
          },
        ],
      },
      baseInput
    )

    expect(matched).toBe(true)
  })

  it('matches header and attachment predicates', () => {
    const matched = evaluateCondition(
      {
        type: 'condition_group',
        version: 1,
        groupOperator: 'all',
        children: [
          {
            type: 'predicate',
            version: 1,
            field: 'header',
            headerName: 'x-priority',
            operator: 'equals',
            value: 'high',
          },
          {
            type: 'predicate',
            version: 1,
            field: 'has_attachment',
            operator: 'equals',
            value: true,
          },
        ],
      },
      baseInput
    )

    expect(matched).toBe(true)
  })
})
