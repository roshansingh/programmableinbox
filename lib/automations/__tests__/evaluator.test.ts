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
  createdAt: new Date('2026-08-11T13:05:13.000Z'),
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

  it('supports not_contains predicates for subject', () => {
    const matched = evaluateCondition(
      {
        type: 'predicate',
        version: 1,
        field: 'subject',
        operator: 'not_contains',
        value: 'invoice',
      },
      {
        subject: 'Weekly status',
        from: '',
        to: [],
        cc: [],
        bcc: [],
        bodyText: '',
        bodyHtml: '',
        createdAt: new Date('2026-08-11T13:05:13.000Z'),
        headers: {},
        tags: [],
        hasAttachment: false,
        attachments: [],
        messageId: 'm1',
        inboxId: 'i1',
        inboxEmail: 'inbox@example.com',
        organizationId: 'org1',
      }
    )

    expect(matched).toBe(true)
  })

  it('supports not_equals predicates for headers', () => {
    const matched = evaluateCondition(
      {
        type: 'predicate',
        version: 1,
        field: 'header',
        headerName: 'x-priority',
        operator: 'not_equals',
        value: 'low',
      },
      baseInput
    )

    expect(matched).toBe(true)
  })

  it('supports not_exists predicates for missing headers', () => {
    const matched = evaluateCondition(
      {
        type: 'predicate',
        version: 1,
        field: 'header',
        headerName: 'x-missing',
        operator: 'not_exists',
      },
      baseInput
    )

    expect(matched).toBe(true)
  })
})
