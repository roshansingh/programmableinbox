import { describe, expect, it } from 'vitest'
import { actionNodeSchema } from '@/lib/automations/schemas'

function sendWebhookNode(url: string) {
  return {
    id: 'a1',
    type: 'action',
    version: 1,
    actionType: 'send_webhook',
    onError: 'stop',
    config: { type: 'send_webhook_config', version: 1, url, method: 'POST' },
  }
}

describe('send_webhook action schema', () => {
  it.each(['https://hooks.example.com/webhook', 'http://hooks.example.com/webhook'])(
    'accepts the http(s) URL %s',
    (url) => {
      expect(actionNodeSchema.safeParse(sendWebhookNode(url)).success).toBe(true)
    }
  )

  // `z.string().url()` on its own accepts these; the scheme allowlist does not.
  it.each(['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com/'])(
    'rejects the non-http(s) URL %s',
    (url) => {
      const result = actionNodeSchema.safeParse(sendWebhookNode(url))
      expect(result.success).toBe(false)
    }
  )

  it('rejects a non-URL string', () => {
    expect(actionNodeSchema.safeParse(sendWebhookNode('not a url')).success).toBe(false)
  })
})

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
