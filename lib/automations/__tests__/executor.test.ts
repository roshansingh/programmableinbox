import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationRunStatus } from '@/lib/generated/prisma/client'

const {
  automationRunCreate,
  automationRunUpdate,
  automationNodeRunCreate,
  automationNodeRunUpdate,
  executeActionNode,
} = vi.hoisted(() => ({
  automationRunCreate: vi.fn(),
  automationRunUpdate: vi.fn(),
  automationNodeRunCreate: vi.fn(),
  automationNodeRunUpdate: vi.fn(),
  executeActionNode: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    automationRun: {
      create: automationRunCreate,
      update: automationRunUpdate,
    },
    automationNodeRun: {
      create: automationNodeRunCreate,
      update: automationNodeRunUpdate,
    },
  },
}))

vi.mock('@/lib/automations/actions', () => ({
  executeActionNode,
}))

import { executeAutomation } from '@/lib/automations/executor'

describe('executeAutomation', () => {
  beforeEach(() => {
    automationRunCreate.mockResolvedValue({ id: 'run-1' })
    automationRunUpdate.mockResolvedValue({ id: 'run-1' })
    automationNodeRunCreate
      .mockResolvedValueOnce({ id: 'node-run-trigger' })
      .mockResolvedValueOnce({ id: 'node-run-action' })
    automationNodeRunUpdate.mockResolvedValue({})
    executeActionNode.mockResolvedValue({
      status: 'succeeded',
      output: { tags: ['triaged'] },
    })
  })

  it('treats a direct trigger-to-action path as matched instead of skipped', async () => {
    const result = await executeAutomation({
      automation: {
        id: 'automation-1',
        name: 'Auto tag',
        organizationId: 'org-1',
      },
      revision: {
        id: 'revision-1',
        revision: 1,
        config: {
          type: 'email_automation',
          version: 1,
          settings: {
            priority: 0,
            stopPolicy: 'continue',
          },
          trigger: {
            id: 'trigger-1',
            type: 'trigger',
            version: 1,
            triggerType: 'email.received',
            config: {
              type: 'email_received',
              version: 1,
            },
          },
          nodes: [
            {
              id: 'trigger-1',
              type: 'trigger',
              version: 1,
              triggerType: 'email.received',
              config: {
                type: 'email_received',
                version: 1,
              },
            },
            {
              id: 'action-1',
              type: 'action',
              version: 1,
              actionType: 'add_tag',
              config: {
                type: 'add_tag_config',
                version: 1,
                tags: ['triaged'],
              },
            },
          ],
          edges: [
            {
              id: 'edge-1',
              type: 'edge',
              version: 1,
              sourceNodeId: 'trigger-1',
              sourceHandle: 'next',
              targetNodeId: 'action-1',
            },
          ],
        },
        layout: {
          type: 'react_flow_layout',
          version: 1,
          positions: {
            'trigger-1': { x: 0, y: 0 },
            'action-1': { x: 200, y: 0 },
          },
        },
      },
      message: {
        id: 'message-1',
        from: 'sender@example.com',
        to: ['inbox@example.com'],
        cc: [],
        bcc: [],
        subject: 'Hello',
        text: 'Body',
        html: '<p>Body</p>',
        headers: {},
        organizationId: 'org-1',
        inboxEmailAddressId: 'inbox-address-1',
        tags: [],
      },
      inbox: {
        id: 'inbox-1',
        email: 'inbox@example.com',
      },
      attachments: [],
    })

    expect(result).toEqual({
      matched: true,
      status: 'succeeded',
      runId: 'run-1',
    })

    expect(automationRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        status: AutomationRunStatus.succeeded,
      }),
    })
  })

  it('executes all reachable action nodes after a true condition', async () => {
    automationNodeRunCreate
      .mockResolvedValueOnce({ id: 'node-run-trigger' })
      .mockResolvedValueOnce({ id: 'node-run-condition' })
      .mockResolvedValueOnce({ id: 'node-run-action-a' })
      .mockResolvedValueOnce({ id: 'node-run-action-b' })

    const result = await executeAutomation({
      automation: {
        id: 'automation-1',
        name: 'Fanout actions',
        organizationId: 'org-1',
      },
      revision: {
        id: 'revision-1',
        revision: 1,
        config: {
          type: 'email_automation',
          version: 1,
          settings: {
            priority: 0,
            stopPolicy: 'continue',
          },
          trigger: {
            id: 'trigger-1',
            type: 'trigger',
            version: 1,
            triggerType: 'email.received',
            config: {
              type: 'email_received',
              version: 1,
            },
          },
          nodes: [
            {
              id: 'trigger-1',
              type: 'trigger',
              version: 1,
              triggerType: 'email.received',
              config: {
                type: 'email_received',
                version: 1,
              },
            },
            {
              id: 'condition-1',
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
                    value: 'Hello',
                  },
                ],
              },
            },
            {
              id: 'action-a',
              type: 'action',
              version: 1,
              actionType: 'add_tag',
              config: {
                type: 'add_tag_config',
                version: 1,
                tags: ['triaged'],
              },
            },
            {
              id: 'action-b',
              type: 'action',
              version: 1,
              actionType: 'send_webhook',
              config: {
                type: 'send_webhook_config',
                version: 1,
                url: 'https://example.com/hook',
              },
            },
          ],
          edges: [
            {
              id: 'edge-trigger-condition',
              type: 'edge',
              version: 1,
              sourceNodeId: 'trigger-1',
              sourceHandle: 'next',
              targetNodeId: 'condition-1',
            },
            {
              id: 'edge-condition-action-a',
              type: 'edge',
              version: 1,
              sourceNodeId: 'condition-1',
              sourceHandle: 'next',
              targetNodeId: 'action-a',
            },
            {
              id: 'edge-condition-action-b',
              type: 'edge',
              version: 1,
              sourceNodeId: 'condition-1',
              sourceHandle: 'next',
              targetNodeId: 'action-b',
            },
          ],
        },
        layout: {
          type: 'react_flow_layout',
          version: 1,
          positions: {
            'trigger-1': { x: 0, y: 0 },
            'condition-1': { x: 150, y: 0 },
            'action-a': { x: 300, y: -60 },
            'action-b': { x: 300, y: 60 },
          },
        },
      },
      message: {
        id: 'message-1',
        from: 'sender@example.com',
        to: ['inbox@example.com'],
        cc: [],
        bcc: [],
        subject: 'Hello world',
        text: 'Body',
        html: '<p>Body</p>',
        headers: {},
        organizationId: 'org-1',
        inboxEmailAddressId: 'inbox-address-1',
        tags: [],
      },
      inbox: {
        id: 'inbox-1',
        email: 'inbox@example.com',
      },
      attachments: [],
    })

    expect(result).toEqual({
      matched: true,
      status: 'succeeded',
      runId: 'run-1',
    })
    // Condition node and 2 actions are executed
    expect(executeActionNode).toHaveBeenCalledTimes(3)
  })

  it('writes each node-run in its terminal state, never an intermediate running row (F28)', async () => {
    await executeAutomation({
      automation: { id: 'automation-1', name: 'Auto tag', organizationId: 'org-1' },
      revision: {
        id: 'revision-1',
        revision: 1,
        config: {
          type: 'email_automation',
          version: 1,
          settings: { priority: 0, stopPolicy: 'continue' },
          trigger: {
            id: 'trigger-1',
            type: 'trigger',
            version: 1,
            triggerType: 'email.received',
            config: { type: 'email_received', version: 1 },
          },
          nodes: [
            {
              id: 'trigger-1',
              type: 'trigger',
              version: 1,
              triggerType: 'email.received',
              config: { type: 'email_received', version: 1 },
            },
            {
              id: 'action-1',
              type: 'action',
              version: 1,
              actionType: 'add_tag',
              config: { type: 'add_tag_config', version: 1, tags: ['triaged'] },
            },
          ],
          edges: [
            {
              id: 'edge-1',
              type: 'edge',
              version: 1,
              sourceNodeId: 'trigger-1',
              sourceHandle: 'next',
              targetNodeId: 'action-1',
            },
          ],
        },
        layout: { type: 'react_flow_layout', version: 1, positions: {} },
      },
      message: {
        id: 'message-1',
        from: 'sender@example.com',
        to: ['inbox@example.com'],
        cc: [],
        bcc: [],
        subject: 'Hello',
        text: 'Body',
        html: '<p>Body</p>',
        headers: {},
        organizationId: 'org-1',
        inboxEmailAddressId: 'inbox-address-1',
        tags: [],
      },
      inbox: { id: 'inbox-1', email: 'inbox@example.com' },
      attachments: [],
    })

    // No create-then-update: a hard crash can no longer leave a node-run stuck
    // at 'running'.
    expect(automationNodeRunUpdate).not.toHaveBeenCalled()

    // Every node-run is inserted already terminal, with a finishedAt.
    expect(automationNodeRunCreate.mock.calls.length).toBeGreaterThan(0)
    for (const [args] of automationNodeRunCreate.mock.calls) {
      expect(args.data.status).not.toBe(AutomationRunStatus.running)
      expect(args.data.finishedAt).toBeInstanceOf(Date)
    }
  })

  it('writes a terminal failed node-run with a real duration when an action throws (F28)', async () => {
    automationNodeRunCreate.mockReset().mockResolvedValue({ id: 'node-run' })
    executeActionNode.mockRejectedValueOnce(new Error('network down'))

    await expect(
      executeAutomation({
        automation: { id: 'automation-1', name: 'Auto tag', organizationId: 'org-1' },
        revision: {
          id: 'revision-1',
          revision: 1,
          config: {
            type: 'email_automation',
            version: 1,
            settings: { priority: 0, stopPolicy: 'continue' },
            trigger: {
              id: 'trigger-1',
              type: 'trigger',
              version: 1,
              triggerType: 'email.received',
              config: { type: 'email_received', version: 1 },
            },
            nodes: [
              {
                id: 'trigger-1',
                type: 'trigger',
                version: 1,
                triggerType: 'email.received',
                config: { type: 'email_received', version: 1 },
              },
              {
                id: 'action-1',
                type: 'action',
                version: 1,
                actionType: 'send_webhook',
                config: { type: 'send_webhook_config', version: 1, url: 'https://example.com/hook' },
              },
            ],
            edges: [
              {
                id: 'edge-1',
                type: 'edge',
                version: 1,
                sourceNodeId: 'trigger-1',
                sourceHandle: 'next',
                targetNodeId: 'action-1',
              },
            ],
          },
          layout: { type: 'react_flow_layout', version: 1, positions: {} },
        },
        message: {
          id: 'message-1',
          from: 'sender@example.com',
          to: ['inbox@example.com'],
          cc: [],
          bcc: [],
          subject: 'Hello',
          text: 'Body',
          html: '<p>Body</p>',
          headers: {},
          organizationId: 'org-1',
          inboxEmailAddressId: 'inbox-address-1',
          tags: [],
        },
        inbox: { id: 'inbox-1', email: 'inbox@example.com' },
        attachments: [],
      }),
    ).rejects.toThrow('network down')

    // The thrown action still yields a terminal failed node-run (breadcrumb),
    // never a stranded 'running' one, and it carries a real startedAt→finishedAt.
    const failed = automationNodeRunCreate.mock.calls
      .map(([args]) => args.data)
      .find((data) => data.configNodeId === 'action-1')
    expect(failed?.status).toBe(AutomationRunStatus.failed)
    expect(failed?.startedAt).toBeInstanceOf(Date)
    expect(failed?.finishedAt).toBeInstanceOf(Date)
    expect(automationNodeRunUpdate).not.toHaveBeenCalled()
  })
})
