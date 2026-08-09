import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const messageFindUniqueMock = vi.fn()
const automationFindManyMock = vi.fn()
const executeAutomationMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    emailMessage: { findUnique: (...a: unknown[]) => messageFindUniqueMock(...a) },
    automation: { findMany: (...a: unknown[]) => automationFindManyMock(...a) },
  },
}))

vi.mock('@/lib/automations/executor', () => ({
  executeAutomation: (...a: unknown[]) => executeAutomationMock(...a),
}))

vi.mock('@/lib/automations/serialization', () => ({
  parseAutomationConfig: () => ({ settings: { priority: 1, stopPolicy: 'continue' } }),
}))

const MESSAGE = {
  id: 'msg_1',
  organizationId: 'org_1',
  inboxEmailAddressId: 'inbox_1',
  inboxEmailAddress: { id: 'inbox_1', email: 'a@example.com' },
  attachments: [],
}

const AUTOMATION = {
  id: 'auto_1',
  organizationId: 'org_1',
  activeRevisionId: 'rev_1',
  activeRevision: { id: 'rev_1', revision: 1, config: {} },
}

async function configurePlan(
  overrides: { automationsEnabled?: boolean },
  quotaAllowed = true,
) {
  const { CommercialProvider } = await import('@/lib/commercial/provider')
  const { UNLIMITED } = await import('@/lib/commercial/plan-limits')
  const consume = vi.fn().mockResolvedValue({
    allowed: quotaAllowed,
    limit: 500,
    used: quotaAllowed ? 1 : 500,
    resetsAt: null,
  })

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
    { consume, refund: vi.fn(), peek: vi.fn(), increment: vi.fn() },
    CommercialProvider.metering,
  )
  return { consume }
}

/**
 * Automation runs are metered at dispatch rather than inside the executor: one
 * inbound email can trigger several automations, and each is a unit of work
 * worth counting separately.
 */
describe('dispatchAutomationsForEmail plan gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    messageFindUniqueMock.mockResolvedValue(MESSAGE)
    automationFindManyMock.mockResolvedValue([AUTOMATION])
    executeAutomationMock.mockResolvedValue({ matched: true })
  })

  afterEach(async () => {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    CommercialProvider.reset()
  })

  it('runs automations under the unlimited OSS default', async () => {
    const { dispatchAutomationsForEmail } = await import('../dispatcher')

    const results = await dispatchAutomationsForEmail('msg_1')

    expect(results).toHaveLength(1)
    expect(executeAutomationMock).toHaveBeenCalled()
  })

  it('runs nothing when the plan excludes automations', async () => {
    await configurePlan({ automationsEnabled: false })
    const { dispatchAutomationsForEmail } = await import('../dispatcher')

    const results = await dispatchAutomationsForEmail('msg_1')

    expect(results).toEqual([])
    expect(executeAutomationMock).not.toHaveBeenCalled()
  })

  /**
   * Checked before the automation query, not after: a plan without automations
   * should not pay to look them up on every inbound message.
   */
  it('does not query automations at all when the feature is off', async () => {
    await configurePlan({ automationsEnabled: false })
    const { dispatchAutomationsForEmail } = await import('../dispatcher')

    await dispatchAutomationsForEmail('msg_1')

    expect(automationFindManyMock).not.toHaveBeenCalled()
  })

  it('consumes one unit of automation.runs per automation executed', async () => {
    const { consume } = await configurePlan({ automationsEnabled: true })
    const { dispatchAutomationsForEmail } = await import('../dispatcher')

    await dispatchAutomationsForEmail('msg_1')

    expect(consume).toHaveBeenCalledWith('org_1', 'automation.runs', 1, expect.anything())
  })

  it('stops executing once the run meter is exhausted', async () => {
    await configurePlan({ automationsEnabled: true }, false)
    const { dispatchAutomationsForEmail } = await import('../dispatcher')

    const results = await dispatchAutomationsForEmail('msg_1')

    expect(results).toEqual([])
    expect(executeAutomationMock).not.toHaveBeenCalled()
  })
})
