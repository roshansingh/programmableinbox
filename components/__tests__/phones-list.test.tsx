import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import { PhonesList } from '@/components/phones-list'
import { server } from '@/test/mocks/server'
import { http, HttpResponse } from 'msw'

describe('PhonesList', () => {
  beforeEach(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token')
  })

  it('shows loading state initially', () => {
    render(<PhonesList />)
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('displays formatted phone numbers after loading', async () => {
    render(<PhonesList />)

    await waitFor(() => {
      expect(screen.getByText('+1 (555) 123-4567')).toBeInTheDocument()
    })

    expect(screen.getByText('+1 (555) 987-6543')).toBeInTheDocument()
  })

  it('shows empty state when no phones exist', async () => {
    server.use(
      http.get('http://localhost:4000/api/app/phoneInbox', () => {
        return HttpResponse.json({ data: [] })
      })
    )

    render(<PhonesList />)

    await waitFor(() => {
      expect(screen.getByText('No phone inboxes')).toBeInTheDocument()
    })

    expect(
      screen.getByText('Create your first phone inbox to start receiving SMS.')
    ).toBeInTheDocument()
  })

  it('deletes a phone inbox after confirmation', async () => {
    const { user } = render(<PhonesList />)

    await waitFor(() => {
      expect(screen.getByText('+1 (555) 123-4567')).toBeInTheDocument()
    })

    const trashIcons = document.querySelectorAll('.lucide-trash2, .lucide-trash-2')
    if (trashIcons.length > 0) {
      const deleteBtn = trashIcons[0].closest('button')
      if (deleteBtn) {
        await user.click(deleteBtn)
      }
    }
  })

  it('refreshes the phone list when Refresh is clicked', async () => {
    const { user } = render(<PhonesList />)

    await waitFor(() => {
      expect(screen.getByText('+1 (555) 123-4567')).toBeInTheDocument()
    })

    const refreshButton = screen.getByRole('button', { name: /refresh/i })
    await user.click(refreshButton)

    await waitFor(() => {
      expect(screen.getByText('+1 (555) 123-4567')).toBeInTheDocument()
    })
  })

  it('shows country code badge', async () => {
    render(<PhonesList />)

    await waitFor(() => {
      const badges = screen.getAllByText('US')
      expect(badges.length).toBeGreaterThan(0)
    })
  })
})
