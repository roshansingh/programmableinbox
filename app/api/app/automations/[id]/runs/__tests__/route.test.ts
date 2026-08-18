import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveUserPrincipalFromTokenMock = vi.fn()
const automationFindFirstMock = vi.fn()
const automationRunFindManyMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    automation: {
      findFirst: (...args: unknown[]) => automationFindFirstMock(...args),
    },
    automationRun: {
      findMany: (...args: unknown[]) => automationRunFindManyMock(...args),
    },
  },
}))

async function loadRoute() {
  return await import('../route')
}

function makeRequest() {
  return new Request('http://localhost/api/app/automations/automation_1/runs', {
    headers: { authorization: 'Bearer token' },
  })
}

describe('GET /api/app/automations/[id]/runs', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
    automationFindFirstMock.mockResolvedValue({
      id: 'automation_1',
      organizationId: 'org_1',
      activeRevision: null,
      revisions: [],
    })
  })

  it('includes the source email (from, subject, thread) for each run', async () => {
    automationRunFindManyMock.mockResolvedValue([
      {
        id: 'run_1',
        status: 'succeeded',
        triggerType: 'email.received',
        isDryRun: false,
        emailMessageId: 'message_1',
        emailMessage: {
          id: 'message_1',
          from: 'sender@example.com',
          subject: 'Your order has shipped',
          inboxEmailAddressId: 'inbox_1',
          threadId: 'thread_1',
        },
        startedAt: new Date('2026-08-18T10:00:00.000Z'),
        finishedAt: new Date('2026-08-18T10:00:01.000Z'),
        nodeRuns: [],
      },
    ])

    const { GET } = await loadRoute()
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: 'automation_1' }),
    })
    const body = await response.json()

    expect(automationRunFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          emailMessage: expect.objectContaining({
            select: {
              id: true,
              from: true,
              subject: true,
              inboxEmailAddressId: true,
              threadId: true,
            },
          }),
        }),
      })
    )
    expect(body.data[0].emailMessage).toEqual({
      id: 'message_1',
      from: 'sender@example.com',
      subject: 'Your order has shipped',
      inboxEmailAddressId: 'inbox_1',
      threadId: 'thread_1',
    })
  })

  it('returns null emailMessage for a run with no associated message', async () => {
    automationRunFindManyMock.mockResolvedValue([
      {
        id: 'run_2',
        status: 'skipped',
        triggerType: 'email.received',
        isDryRun: false,
        emailMessageId: null,
        emailMessage: null,
        startedAt: new Date('2026-08-18T10:00:00.000Z'),
        finishedAt: null,
        nodeRuns: [],
      },
    ])

    const { GET } = await loadRoute()
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: 'automation_1' }),
    })
    const body = await response.json()

    expect(body.data[0].emailMessage).toBeNull()
  })
})
