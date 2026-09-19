import { describe, it, expect, afterEach } from 'vitest'
import { findForwardEmailDomainViolations } from '@/lib/automations/outbound-policy'
import { resetConfigCache } from '@/lib/config'
import { AUTOMATION_CONFIG_TYPE, AUTOMATION_SCHEMA_VERSION } from '@/lib/automations/types'
import type { AutomationConfig, ActionNodeConfig } from '@/lib/automations/types'

const ORIGINAL = process.env.EMAIL_INBOX_ALLOWED_DOMAINS

function configure(domains: string) {
  process.env.EMAIL_INBOX_ALLOWED_DOMAINS = domains
  resetConfigCache()
}

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.EMAIL_INBOX_ALLOWED_DOMAINS
  } else {
    process.env.EMAIL_INBOX_ALLOWED_DOMAINS = ORIGINAL
  }
  resetConfigCache()
})

function forwardEmailNode(overrides: { to?: string[]; cc?: string[]; bcc?: string[] }): ActionNodeConfig {
  return {
    id: 'node_forward',
    type: 'action',
    version: 1,
    actionType: 'forward_email',
    config: {
      type: 'forward_email_config',
      version: 1,
      to: overrides.to ?? ['dest@example.com'],
      cc: overrides.cc,
      bcc: overrides.bcc,
    },
  }
}

function configWithNodes(nodes: ActionNodeConfig[]): AutomationConfig {
  return {
    type: AUTOMATION_CONFIG_TYPE,
    version: AUTOMATION_SCHEMA_VERSION,
    settings: { priority: 0, stopPolicy: 'continue' },
    trigger: {
      id: 'trigger_1',
      type: 'trigger',
      version: 1,
      triggerType: 'email.received',
      config: { type: 'email_received', version: 1 },
    },
    nodes,
    edges: [],
  }
}

describe('findForwardEmailDomainViolations', () => {
  it('is empty when no forward_email node targets a same-service domain', () => {
    configure('inbox.example.com')
    const config = configWithNodes([forwardEmailNode({ to: ['dest@gmail.com'] })])

    expect(findForwardEmailDomainViolations(config)).toEqual([])
  })

  it('flags a forward_email node whose "to" targets a same-service domain', () => {
    configure('inbox.example.com')
    const config = configWithNodes([forwardEmailNode({ to: ['abuse@inbox.example.com'] })])

    const violations = findForwardEmailDomainViolations(config)

    expect(violations).toEqual([{ nodeId: 'node_forward', addresses: ['abuse@inbox.example.com'] }])
  })

  it('flags a forward_email node whose "cc" or "bcc" targets a same-service domain', () => {
    configure('inbox.example.com')
    const config = configWithNodes([
      forwardEmailNode({ to: ['dest@gmail.com'], cc: ['a@inbox.example.com'], bcc: ['b@inbox.example.com'] }),
    ])

    const violations = findForwardEmailDomainViolations(config)

    expect(violations).toEqual([
      { nodeId: 'node_forward', addresses: ['a@inbox.example.com', 'b@inbox.example.com'] },
    ])
  })

  it('ignores non-forward_email action nodes', () => {
    configure('inbox.example.com')
    const config = configWithNodes([
      {
        id: 'node_tag',
        type: 'action',
        version: 1,
        actionType: 'add_tag',
        config: { type: 'add_tag_config', version: 1, tags: ['abuse@inbox.example.com'] },
      },
    ])

    expect(findForwardEmailDomainViolations(config)).toEqual([])
  })
})
