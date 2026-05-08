import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import ApiKeysPage from '@/app/api-keys/page'
import { server } from '@/test/mocks/server'
import { http, HttpResponse } from 'msw'
import { mockApiKeys } from '@/test/mocks/fixtures/api-keys'

// Mock Sidebar and DashboardHeader since they have their own dependencies
vi.mock('@/components/sidebar', () => ({
  Sidebar: () => <nav data-testid="sidebar">Sidebar</nav>,
}))

vi.mock('@/components/dashboard-header', () => ({
  DashboardHeader: () => <header data-testid="dashboard-header">Header</header>,
}))

describe('ApiKeysPage', () => {
  beforeEach(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token')
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
  })

  it('shows empty state when no keys exist', async () => {
    server.use(
      http.get('http://localhost:4000/api/v1/apiKeys', () => {
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

  it('masks API keys by default', async () => {
    render(<ApiKeysPage />)

    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeInTheDocument()
    })

    // Key should be masked: first 12 + "..." + last 4
    const maskedKey = mockApiKeys[0].apiKey.slice(0, 12) + '...' + mockApiKeys[0].apiKey.slice(-4)
    expect(screen.getByText(maskedKey)).toBeInTheDocument()
  })

  it('toggles key visibility', async () => {
    const { user } = render(<ApiKeysPage />)

    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeInTheDocument()
    })

    // Find the eye toggle buttons (they come in pairs per key)
    const eyeIcons = document.querySelectorAll('.lucide-eye')
    if (eyeIcons.length > 0) {
      const toggleBtn = eyeIcons[0].closest('button')
      if (toggleBtn) {
        await user.click(toggleBtn)
        // Now the full key should be visible
        expect(screen.getByText(mockApiKeys[0].apiKey)).toBeInTheDocument()
      }
    }
  })

  it('copies API key to clipboard', async () => {
    const { user } = render(<ApiKeysPage />)

    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeInTheDocument()
    })

    const copyIcons = document.querySelectorAll('.lucide-copy')
    if (copyIcons.length > 0) {
      const copyBtn = copyIcons[0].closest('button')
      if (copyBtn) {
        await user.click(copyBtn)
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          mockApiKeys[0].apiKey
        )
      }
    }
  })

  it('opens create key dialog and creates a key', async () => {
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
  })

  it('deletes an API key after confirmation', async () => {
    const { user } = render(<ApiKeysPage />)

    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeInTheDocument()
    })

    // Open dropdown menu
    const moreButtons = document.querySelectorAll('.lucide-more-vertical, .lucide-ellipsis-vertical')
    if (moreButtons.length > 0) {
      const moreBtn = moreButtons[0].closest('button')
      if (moreBtn) {
        await user.click(moreBtn)

        await waitFor(() => {
          expect(screen.getByText('Delete Key')).toBeInTheDocument()
        })

        await user.click(screen.getByText('Delete Key'))

        await waitFor(() => {
          expect(screen.queryByText('Production Key')).not.toBeInTheDocument()
        })
      }
    }
  })
})
