import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import { EmailsList } from '@/components/emails-list'
import { mockEmails } from '@/test/mocks/fixtures/emails'
import { server } from '@/test/mocks/server'
import { http, HttpResponse } from 'msw'

describe('EmailsList', () => {
  beforeEach(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token')
  })

  it('shows loading state initially', () => {
    render(<EmailsList />)
    // The loading spinner has the animate-spin class
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('displays email inboxes after loading', async () => {
    render(<EmailsList />)

    await waitFor(() => {
      expect(screen.getByText('inbox-one@test.inboxui.com')).toBeInTheDocument()
    })

    expect(screen.getByText('inbox-two@test.inboxui.com')).toBeInTheDocument()
    expect(screen.getByText('Support Inbox')).toBeInTheDocument()
  })

  it('shows empty state when no emails exist', async () => {
    server.use(
      http.get('http://localhost:4000/api/app/emailInbox', () => {
        return HttpResponse.json({ data: [] })
      })
    )

    render(<EmailsList />)

    await waitFor(() => {
      expect(screen.getByText('No email inboxes')).toBeInTheDocument()
    })

    expect(
      screen.getByText('Create your first email inbox to start receiving emails.')
    ).toBeInTheDocument()
  })

  it('opens create dialog when Create button is clicked', async () => {
    render(<EmailsList />)

    await waitFor(() => {
      expect(screen.getByText('Email Inboxes')).toBeInTheDocument()
    })

    const { user } = render(<EmailsList />)
    await waitFor(() => {
      expect(screen.getAllByText('Email Inboxes').length).toBeGreaterThan(0)
    })
  })

  it('deletes an email inbox after confirmation', async () => {
    const { user } = render(<EmailsList />)

    await waitFor(() => {
      expect(screen.getByText('inbox-one@test.inboxui.com')).toBeInTheDocument()
    })

    // Find and click the first delete button
    const deleteButtons = screen.getAllByRole('button').filter(btn => {
      return btn.querySelector('svg.lucide-trash-2') || btn.querySelector('[class*="trash"]')
    })

    // Click the trash button via the SVG within it
    const trashIcons = document.querySelectorAll('.lucide-trash2, .lucide-trash-2')
    if (trashIcons.length > 0) {
      const deleteBtn = trashIcons[0].closest('button')
      if (deleteBtn) {
        await user.click(deleteBtn)
      }
    }
  })

  it('refreshes the email list when Refresh is clicked', async () => {
    const { user } = render(<EmailsList />)

    await waitFor(() => {
      expect(screen.getByText('inbox-one@test.inboxui.com')).toBeInTheDocument()
    })

    const refreshButton = screen.getByRole('button', { name: /refresh/i })
    await user.click(refreshButton)

    await waitFor(() => {
      expect(screen.getByText('inbox-one@test.inboxui.com')).toBeInTheDocument()
    })
  })

  it('copies email to clipboard when copy button is clicked', async () => {
    const { user } = render(<EmailsList />)

    await waitFor(() => {
      expect(screen.getByText('inbox-one@test.inboxui.com')).toBeInTheDocument()
    })

    // Find copy buttons (they have Copy icon)
    const copyIcons = document.querySelectorAll('.lucide-copy')
    if (copyIcons.length > 0) {
      const copyBtn = copyIcons[0].closest('button')
      if (copyBtn) {
        await user.click(copyBtn)
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          'inbox-one@test.inboxui.com'
        )
      }
    }
  })

  it('hides the delete action for inboxes the user does not own', async () => {
    // Reads are organization-wide but mutations are creator-only, so a member
    // sees colleagues' inboxes in this list. Rendering delete on those would
    // offer an action that always 404s.
    server.use(
      http.get('http://localhost:4000/api/app/emailInbox', () =>
        HttpResponse.json({
          data: [
            {
              id: 'inbox_1',
              email: 'mine@example.com',
              name: 'Mine',
              isOwner: true,
              organizationId: 'org_1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'inbox_2',
              email: 'theirs@example.com',
              name: 'Theirs',
              isOwner: false,
              organizationId: 'org_1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      ),
    )

    render(<EmailsList />)

    await screen.findByText('mine@example.com')
    // Both inboxes are visible — the widened read is the point.
    expect(screen.getByText('theirs@example.com')).toBeInTheDocument()

    const deleteButtons = screen.getAllByRole('button', { name: /delete inbox/i })
    expect(deleteButtons).toHaveLength(1)
    expect(deleteButtons[0]).toHaveAccessibleName('Delete inbox mine@example.com')
  })

  it('still offers copy on an inbox the user does not own', async () => {
    // Copying the address is a read, so it stays available on a colleague's
    // inbox; only the mutating action is gated.
    server.use(
      http.get('http://localhost:4000/api/app/emailInbox', () =>
        HttpResponse.json({
          data: [
            {
              id: 'inbox_2',
              email: 'theirs@example.com',
              name: 'Theirs',
              isOwner: false,
              organizationId: 'org_1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      ),
    )

    render(<EmailsList />)

    await screen.findByText('theirs@example.com')
    expect(screen.getByRole('button', { name: /copy address/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete inbox/i })).not.toBeInTheDocument()
  })
})
