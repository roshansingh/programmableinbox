import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@/test/test-utils'
import { PhonesList } from '@/components/phones-list'
import { server } from '@/test/mocks/server'
import { http, HttpResponse } from 'msw'
import { setMockSessionCookie } from '@/test/mocks/session-cookie'

describe('PhonesList', () => {
  beforeEach(() => {
    setMockSessionCookie()
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

  describe('deleting a phone inbox', () => {
    const deleteButtonName = 'Delete phone inbox +1 (555) 123-4567'
    let deletedIds: string[]

    beforeEach(() => {
      deletedIds = []
      server.use(
        http.delete('http://localhost:4000/api/app/phoneInbox/:id', ({ params }) => {
          deletedIds.push(String(params.id))
          return new HttpResponse(null, { status: 204 })
        }),
      )
    })

    it('asks for confirmation in a modal, not a native dialog, before deleting', async () => {
      const confirmSpy = vi.mocked(window.confirm)
      confirmSpy.mockClear()
      const { user } = render(<PhonesList />)

      await user.click(await screen.findByRole('button', { name: deleteButtonName }))

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('+1 (555) 123-4567')
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(deletedIds).toEqual([])
    })

    it('deletes the phone inbox once the modal is confirmed', async () => {
      const { user } = render(<PhonesList />)

      await user.click(await screen.findByRole('button', { name: deleteButtonName }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(screen.queryByText('+1 (555) 123-4567')).not.toBeInTheDocument()
      })
      expect(deletedIds).toEqual(['phone-1'])
      expect(screen.getByText('+1 (555) 987-6543')).toBeInTheDocument()
    })

    it('keeps the phone inbox and sends no request when the modal is cancelled', async () => {
      const { user } = render(<PhonesList />)

      await user.click(await screen.findByRole('button', { name: deleteButtonName }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
      expect(deletedIds).toEqual([])
      expect(screen.getByText('+1 (555) 123-4567')).toBeInTheDocument()
    })
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
