import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@/test/test-utils'
import ApiKeysPage from '@/app/api-keys/page'
import { server } from '@/test/mocks/server'
import { http, HttpResponse } from 'msw'
import { mockApiKeyList, mockCreatedApiKey } from '@/test/mocks/fixtures/api-keys'
import { setMockSessionCookie } from '@/test/mocks/session-cookie'

// Mock Sidebar and DashboardHeader since they have their own dependencies
vi.mock('@/components/sidebar', () => ({
  Sidebar: () => <nav data-testid="sidebar">Sidebar</nav>,
}))

vi.mock('@/components/dashboard-header', () => ({
  DashboardHeader: () => <header data-testid="dashboard-header">Header</header>,
}))

describe('ApiKeysPage', () => {
  beforeEach(() => {
    setMockSessionCookie()
  })

  it('shows loading state initially', () => {
    render(<ApiKeysPage />)
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('displays API keys after loading', async () => {
    render(<ApiKeysPage />)

    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeInTheDocument()
    })

    expect(screen.getByText('Development Key')).toBeInTheDocument()
    expect(screen.getByText(mockApiKeyList[0].prefix)).toBeInTheDocument()
    expect(screen.getAllByText('email_inboxes:read')).toHaveLength(2)
    expect(screen.getByText('email_messages:read')).toBeInTheDocument()
  })

  it('shows empty state when no keys exist', async () => {
    server.use(
      http.get('http://localhost:4000/api/app/apiKeys', () => {
        return HttpResponse.json({ data: [] })
      })
    )

    render(<ApiKeysPage />)

    await waitFor(() => {
      expect(screen.getByText('No API Keys')).toBeInTheDocument()
    })

    expect(
      screen.getByText('Create your first API key to start using the programmable inbox API.')
    ).toBeInTheDocument()
  })

  it('renders metadata-only API key entries', async () => {
    render(<ApiKeysPage />)

    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeInTheDocument()
    })

    expect(screen.getByText(mockApiKeyList[0].prefix)).toBeInTheDocument()
    expect(screen.queryByText(mockCreatedApiKey.apiKey)).not.toBeInTheDocument()
    expect(document.querySelector('.lucide-eye')).not.toBeInTheDocument()
  })

  it('shows the raw key once after creation and then falls back to metadata in the list', async () => {
    const { user } = render(<ApiKeysPage />)

    await waitFor(() => {
      expect(screen.getByText('API Keys')).toBeInTheDocument()
    })

    // Click "Create API Key" button
    const createButton = screen.getByRole('button', { name: /create api key/i })
    await user.click(createButton)

    // Fill in the name
    const nameInput = screen.getByPlaceholderText('e.g., Production API Key')
    await user.type(nameInput, 'My New Key')

    await user.click(screen.getByLabelText('email_inboxes:read'))
    await user.click(screen.getByLabelText('email_messages:read'))

    // Click "Create Key" submit button
    const submitButton = screen.getByRole('button', { name: /^create key$/i })
    await user.click(submitButton)

    // Should show the created key dialog
    await waitFor(() => {
      expect(screen.getByText('API Key Created')).toBeInTheDocument()
    })

    expect(
      screen.getByText("Copy your API key now. You won't be able to see it again!")
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue(mockCreatedApiKey.apiKey)).toBeInTheDocument()
    expect(screen.getAllByText('email_inboxes:read').length).toBeGreaterThan(1)
    expect(screen.getAllByText('email_messages:read').length).toBeGreaterThan(1)

    await user.click(screen.getByRole('button', { name: /done/i }))

    await waitFor(() => {
      expect(screen.queryByDisplayValue(mockCreatedApiKey.apiKey)).not.toBeInTheDocument()
    })

    expect(screen.getByText(mockCreatedApiKey.prefix)).toBeInTheDocument()
    expect(screen.queryByText(mockCreatedApiKey.apiKey)).not.toBeInTheDocument()
  })

  it('explains what each scope grants, so a mutating one is not just another checkbox', async () => {
    const { user } = render(<ApiKeysPage />)

    await waitFor(() => expect(screen.getByText('API Keys')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /create api key/i }))

    // Five bare `email_*` strings give a user no way to tell which of them
    // claim addresses, which rename, and which retire an address for good.
    expect(screen.getByText(/claim new inbox addresses/i)).toBeInTheDocument()
    expect(screen.getByText(/rename inboxes/i)).toBeInTheDocument()
    // The delete description has to say the part that cannot be undone.
    expect(screen.getByText(/never be claimed again/i)).toBeInTheDocument()
  })

  it('ticks the inbox read scope when a mutating scope is selected', async () => {
    // The scopes do not imply one another on the server — the effective grant
    // of a ticked box must equal its label. But a key that can create an inbox
    // and cannot list what it created is a strange object, so the dialog picks
    // the read scope up rather than leaving the user to notice.
    const { user } = render(<ApiKeysPage />)

    await waitFor(() => expect(screen.getByText('API Keys')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /create api key/i }))

    await user.click(screen.getByLabelText('email_inboxes:delete'))

    expect(screen.getByLabelText('email_inboxes:read')).toBeChecked()
    expect(screen.getByLabelText('email_inboxes:delete')).toBeChecked()
    // Not granted by implication — messages are a separate capability, and so
    // is every other mutating scope. Deleting does not imply creating.
    expect(screen.getByLabelText('email_messages:read')).not.toBeChecked()
    expect(screen.getByLabelText('email_inboxes:create')).not.toBeChecked()
    expect(screen.getByLabelText('email_inboxes:update')).not.toBeChecked()
  })

  describe('deleting an API key', () => {
    let deletedIds: string[]

    beforeEach(() => {
      deletedIds = []
      server.use(
        http.delete('http://localhost:4000/api/app/apiKeys/:id', ({ params }) => {
          deletedIds.push(String(params.id))
          return new HttpResponse(null, { status: 204 })
        }),
      )
    })

    async function openDeleteModal(user: ReturnType<typeof render>['user']) {
      await user.click(await screen.findByRole('button', { name: 'Actions for Production Key' }))
      await user.click(await screen.findByRole('menuitem', { name: /delete key/i }))
      return screen.findByRole('alertdialog')
    }

    it('asks for confirmation in a modal, not a native dialog, before deleting', async () => {
      const confirmSpy = vi.mocked(window.confirm)
      confirmSpy.mockClear()
      const { user } = render(<ApiKeysPage />)

      const dialog = await openDeleteModal(user)

      expect(dialog).toHaveTextContent('Production Key')
      expect(dialog).toHaveTextContent(/cannot be undone/i)
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(deletedIds).toEqual([])
    })

    it('deletes the key once the modal is confirmed', async () => {
      const { user } = render(<ApiKeysPage />)

      const dialog = await openDeleteModal(user)
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(screen.queryByText('Production Key')).not.toBeInTheDocument()
      })
      expect(deletedIds).toEqual(['key-1'])
      expect(screen.getByText('Development Key')).toBeInTheDocument()
    })

    it('keeps the key and sends no request when the modal is cancelled', async () => {
      const { user } = render(<ApiKeysPage />)

      const dialog = await openDeleteModal(user)
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
      expect(deletedIds).toEqual([])
      expect(screen.getByText('Production Key')).toBeInTheDocument()
    })
  })
})
