/**
 * Save-time policy (`lib/automations/outbound-policy.ts`, enforced by the
 * automation create/update routes) keeps a new `forward_email` node from
 * being saved with a same-service recipient, but an automation saved before
 * that rule existed — or one whose target domain is added to
 * EMAIL_INBOX_ALLOWED_DOMAINS later — can still reach execution. This is the
 * defense-in-depth recheck at send time, for both outbound paths: forwarding
 * a configured "to" address (forward_email) and replying to the original
 * sender (auto_reply).
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionNodeConfig, EmailAutomationInput } from '@/lib/automations/types'
import { withConfigEnv } from '@/test/config'
import { CommercialProvider } from '@/lib/commercial/provider'
import { UNLIMITED } from '@/lib/commercial/plan-limits'

const sendMock = vi.fn()
const ledgerFindUniqueMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    emailMessage: { update: vi.fn() },
    autoReplyLedger: {
      findUnique: (...a: unknown[]) => ledgerFindUniqueMock(...a),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}))
vi.mock('@/lib/resend', () => ({ getResend: () => ({ emails: { send: sendMock } }) }))
vi.mock('@/lib/automations/auto-reply-throttle', () => ({
  claimAutoReplySlot: vi.fn().mockResolvedValue({ claimed: true }),
  releaseAutoReplySlot: vi.fn(),
}))

import { executeActionNode } from '@/lib/automations/actions'

function baseInput(overrides: Partial<EmailAutomationInput> = {}): EmailAutomationInput {
  return {
    messageId: 'message-1',
    inboxId: 'inbox-1',
    inboxEmail: 'inbox@test.dev',
    organizationId: 'org-1',
    from: 'sender@example.com',
    to: ['inbox@test.dev'],
    cc: [],
    bcc: [],
    subject: 'Order confirmation',
    bodyText: 'hello',
    bodyHtml: '',
    createdAt: new Date('2026-08-11T13:05:13.000Z'),
    headers: {},
    tags: [],
    hasAttachment: false,
    attachments: [],
    ...overrides,
  }
}

function contextWith(input: EmailAutomationInput) {
  return {
    automation: { id: 'automation-1', name: 'Notify' },
    revision: { id: 'revision-1', revision: 1 },
    inbox: { id: 'inbox-1', email: 'inbox@test.dev' },
    input,
    isDryRun: false,
  }
}

function forwardNode(to: string[]): Extract<ActionNodeConfig, { actionType: 'forward_email' }> {
  return {
    id: 'action-1',
    type: 'action',
    version: 1,
    actionType: 'forward_email',
    config: { type: 'forward_email_config', version: 1, to },
  }
}

function autoReplyNode(): Extract<ActionNodeConfig, { actionType: 'auto_reply' }> {
  return {
    id: 'action-2',
    type: 'action',
    version: 1,
    actionType: 'auto_reply',
    config: {
      type: 'auto_reply_config',
      version: 1,
      subjectTemplate: 'Thanks',
      bodyTemplate: 'We got your message',
      oncePerSenderWindowHours: 24,
    },
  }
}

describe('outbound recipient domain gate (runtime)', () => {
  withConfigEnv({ EMAIL_INBOX_ALLOWED_DOMAINS: 'inbox.example.com' })

  beforeEach(() => {
    vi.clearAllMocks()
    sendMock.mockResolvedValue({ data: { id: 'resend-1' }, error: null })
    ledgerFindUniqueMock.mockResolvedValue(null)
    CommercialProvider.configure(
      {
        resolve: async () => ({
          planCode: 'self_hosted',
          planName: 'Self-hosted',
          limits: { ...UNLIMITED, outboundEmail: true },
          periodStart: null,
          periodEnd: null,
        }),
      },
      CommercialProvider.quota,
      CommercialProvider.metering,
    )
  })

  afterEach(() => {
    CommercialProvider.reset()
  })

  describe('forward_email', () => {
    it('fails rather than sends when "to" targets a domain this deployment owns', async () => {
      const result = await executeActionNode(forwardNode(['abuse@inbox.example.com']), contextWith(baseInput()))

      expect(result.status).toBe('failed')
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('still sends to an external address', async () => {
      const result = await executeActionNode(forwardNode(['dest@gmail.com']), contextWith(baseInput()))

      expect(result.status).toBe('succeeded')
      expect(sendMock).toHaveBeenCalled()
    })
  })

  describe('auto_reply', () => {
    it('skips rather than sends when the original sender is on a domain this deployment owns', async () => {
      const context = contextWith(baseInput({ from: 'abuse@inbox.example.com' }))

      const result = await executeActionNode(autoReplyNode(), context)

      expect(result.status).toBe('skipped')
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('does not claim a throttle slot for a blocked sender', async () => {
      const context = contextWith(baseInput({ from: 'abuse@inbox.example.com' }))
      const { claimAutoReplySlot } = await import('@/lib/automations/auto-reply-throttle')

      await executeActionNode(autoReplyNode(), context)

      expect(claimAutoReplySlot).not.toHaveBeenCalled()
    })

    it('still replies to an external sender', async () => {
      const context = contextWith(baseInput({ from: 'sender@example.com' }))

      const result = await executeActionNode(autoReplyNode(), context)

      expect(result.status).toBe('succeeded')
      expect(sendMock).toHaveBeenCalled()
    })
  })
})
