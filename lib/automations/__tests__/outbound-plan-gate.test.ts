import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionNodeConfig, EmailAutomationInput } from '@/lib/automations/types'
import { CommercialProvider } from '@/lib/commercial/provider'
import { UNLIMITED, type PlanLimits } from '@/lib/commercial/plan-limits'

const sendMock = vi.fn()
const ledgerFindFirstMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    emailMessage: { update: vi.fn() },
    autoReplyLedger: {
      findFirst: (...a: unknown[]) => ledgerFindFirstMock(...a),
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

const input: EmailAutomationInput = {
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
  headers: {},
  tags: [],
  hasAttachment: false,
  attachments: [],
}

const context = {
  automation: { id: 'automation-1', name: 'Notify' },
  revision: { id: 'revision-1', revision: 1 },
  inbox: { id: 'inbox-1', email: 'inbox@test.dev' },
  input,
  isDryRun: false,
}

function forwardNode(): Extract<ActionNodeConfig, { actionType: 'forward_email' }> {
  return {
    id: 'action-1',
    type: 'action',
    version: 1,
    actionType: 'forward_email',
    config: {
      type: 'forward_email_config',
      version: 1,
      to: ['ops@example.com'],
    },
  } as Extract<ActionNodeConfig, { actionType: 'forward_email' }>
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
  } as Extract<ActionNodeConfig, { actionType: 'auto_reply' }>
}

function configurePlan(overrides: Partial<PlanLimits>) {
  CommercialProvider.configure(
    {
      resolve: async () => ({
        planCode: 'free',
        planName: 'Free',
        limits: { ...UNLIMITED, ...overrides },
        periodStart: null,
        periodEnd: null,
      }),
    },
    CommercialProvider.quota,
    CommercialProvider.metering,
  )
}

/**
 * Outbound email is one plan switch covering three paths: the manual send
 * route, `forward_email` and `auto_reply`. Gating only the automated ones would
 * leave a free account able to send from a domain we own via the dashboard.
 */
describe('outbound email plan gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendMock.mockResolvedValue({ data: { id: 'resend-1' }, error: null })
    ledgerFindFirstMock.mockResolvedValue(null)
  })

  afterEach(() => {
    CommercialProvider.reset()
  })

  describe('forward_email', () => {
    it('sends when the plan includes outbound email', async () => {
      configurePlan({ outboundEmail: true })

      const result = await executeActionNode(forwardNode(), context)

      expect(result.status).toBe('succeeded')
      expect(sendMock).toHaveBeenCalled()
    })

    /**
     * `skipped`, never `failed`. A plan limit is not a malfunction: reporting it
     * as a failure would mark the whole run failed in the log, mislead the
     * operator about what went wrong, and feed the stuck-run sweeper a run that
     * behaved exactly as configured.
     */
    it('skips rather than fails when the plan excludes outbound email', async () => {
      configurePlan({ outboundEmail: false })

      const result = await executeActionNode(forwardNode(), context)

      expect(result.status).toBe('skipped')
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('records why it skipped, so the run log explains itself', async () => {
      configurePlan({ outboundEmail: false })

      const result = await executeActionNode(forwardNode(), context)

      expect(result.output).toMatchObject({ planLimited: true, planCode: 'free' })
    })
  })

  describe('auto_reply', () => {
    it('sends when the plan includes outbound email', async () => {
      configurePlan({ outboundEmail: true })

      const result = await executeActionNode(autoReplyNode(), context)

      expect(result.status).toBe('succeeded')
      expect(sendMock).toHaveBeenCalled()
    })

    it('skips rather than fails when the plan excludes outbound email', async () => {
      configurePlan({ outboundEmail: false })

      const result = await executeActionNode(autoReplyNode(), context)

      expect(result.status).toBe('skipped')
      expect(sendMock).not.toHaveBeenCalled()
    })

    /**
     * The gate must precede the throttle claim. Claiming a slot for a reply that
     * will never be sent burns the per-sender cooldown, so a later upgrade would
     * find the sender throttled for a reply nobody received.
     */
    it('does not claim a throttle slot for a reply it will not send', async () => {
      configurePlan({ outboundEmail: false })
      const { claimAutoReplySlot } = await import('@/lib/automations/auto-reply-throttle')

      await executeActionNode(autoReplyNode(), context)

      expect(claimAutoReplySlot).not.toHaveBeenCalled()
    })
  })

  describe('send_webhook', () => {
    function webhookNode() {
      return {
        id: 'action-4',
        type: 'action',
        version: 1,
        actionType: 'send_webhook',
        config: {
          type: 'send_webhook_config',
          version: 1,
          url: 'https://hooks.example.com/x',
          method: 'POST',
        },
      } as Extract<ActionNodeConfig, { actionType: 'send_webhook' }>
    }

    it('skips when the plan excludes outbound webhooks', async () => {
      configurePlan({ outboundWebhooks: false })

      const result = await executeActionNode(webhookNode(), context)

      expect(result.status).toBe('skipped')
      expect(result.output).toMatchObject({ planLimited: true })
    })

    /**
     * A dry run makes no outbound request, so it must remain previewable on a
     * plan that cannot deliver — otherwise the editor cannot show what the
     * automation would do before an upgrade.
     */
    it('still previews on a dry run when the plan excludes webhooks', async () => {
      configurePlan({ outboundWebhooks: false })

      const result = await executeActionNode(webhookNode(), { ...context, isDryRun: true })

      expect(result.output).toMatchObject({ dryRun: true })
    })
  })

  describe('non-sending actions', () => {
    /**
     * `outboundEmail: false` gates mail, not automations wholesale. A free
     * account keeps tagging and webhooks — the free plan enables both.
     */
    it('leaves add_tag unaffected', async () => {
      configurePlan({ outboundEmail: false })
      const node = {
        id: 'action-3',
        type: 'action',
        version: 1,
        actionType: 'add_tag',
        config: { type: 'add_tag_config', version: 1, tags: ['urgent'] },
      } as Extract<ActionNodeConfig, { actionType: 'add_tag' }>

      const result = await executeActionNode(node, context)

      expect(result.status).toBe('succeeded')
    })
  })

  describe('OSS default', () => {
    it('sends without consulting a plan when nothing is configured', async () => {
      const result = await executeActionNode(forwardNode(), context)

      expect(result.status).toBe('succeeded')
      expect(sendMock).toHaveBeenCalled()
    })
  })
})
