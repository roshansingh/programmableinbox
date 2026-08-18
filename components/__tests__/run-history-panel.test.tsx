import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { RunHistoryPanel } from '@/components/automations/run-history-panel'
import { getAutomationRuns, type AutomationRunRecord } from '@/lib/api/automations.api'

vi.mock('@/lib/api/automations.api', () => ({
  getAutomationRuns: vi.fn(),
  replayAutomationRun: vi.fn(),
}))

function makeRun(overrides: Partial<AutomationRunRecord> = {}): AutomationRunRecord {
  return {
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
    startedAt: '2026-08-18T10:00:00.000Z',
    finishedAt: '2026-08-18T10:00:01.000Z',
    nodeRuns: [],
    ...overrides,
  }
}

describe('RunHistoryPanel', () => {
  beforeEach(() => {
    vi.mocked(getAutomationRuns).mockReset()
  })

  it('shows the from address and subject with a link to the source email', async () => {
    vi.mocked(getAutomationRuns).mockResolvedValue([makeRun()])

    render(<RunHistoryPanel automationId="automation_1" />)

    expect(await screen.findByText(/From sender@example\.com/)).toBeInTheDocument()
    expect(screen.getByText(/Your order has shipped/)).toBeInTheDocument()

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute(
      'href',
      '/emails/inbox_1?threadId=thread_1&messageId=message_1'
    )
  })

  it('truncates long subjects in the preview', async () => {
    const longSubject = 'A'.repeat(120)
    vi.mocked(getAutomationRuns).mockResolvedValue([
      makeRun({ emailMessage: { ...makeRun().emailMessage!, subject: longSubject } }),
    ])

    render(<RunHistoryPanel automationId="automation_1" />)

    const link = await screen.findByRole('link')
    expect(link.textContent).toContain('…')
    expect(link.textContent!.length).toBeLessThan(longSubject.length)
  })

  it('omits the email link when the run has no associated message', async () => {
    vi.mocked(getAutomationRuns).mockResolvedValue([
      makeRun({ emailMessageId: null, emailMessage: null }),
    ])

    render(<RunHistoryPanel automationId="automation_1" />)

    expect(await screen.findByText('email.received')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
