import { describe, expect, it } from 'vitest'
import { actionNodeSchema } from '@/lib/automations/schemas'

describe('forward_email action schema', () => {
  it('rejects an empty recipient list', () => {
    const result = actionNodeSchema.safeParse({
      id: 'a1',
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
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const hasRecipientIssue = result.error.issues.some(
        (issue) => issue.path.includes('to') && /recipient/i.test(issue.message)
      )
      expect(hasRecipientIssue).toBe(true)
    }
  })

  it('accepts a non-empty recipient list', () => {
    const result = actionNodeSchema.safeParse({
      id: 'a1',
      type: 'action',
      version: 1,
      actionType: 'forward_email',
      onError: 'stop',
      config: {
        type: 'forward_email_config',
        version: 1,
        to: ['user@example.com'],
        includeAttachments: false,
      },
    })

    expect(result.success).toBe(true)
  })
})
