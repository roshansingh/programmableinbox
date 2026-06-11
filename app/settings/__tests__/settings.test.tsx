import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SettingsPage from '../page'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { AuthProvider } from '@/components/auth-provider'
import { Toaster } from 'sonner'

// Mock Sidebar and DashboardHeader since they have their own dependencies
vi.mock('@/components/sidebar', () => ({
  Sidebar: () => <nav data-testid="sidebar">Sidebar</nav>,
}))

vi.mock('@/components/dashboard-header', () => ({
  DashboardHeader: () => <header data-testid="dashboard-header">Header</header>,
}))

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <AuthProvider>
      <Toaster />
      {ui}
    </AuthProvider>
  )
}

describe('SettingsPage', () => {
  beforeEach(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token')
  })

  it('renders email as read-only text', async () => {
    renderWithProviders(<SettingsPage />)
    await waitFor(() => {
      expect(screen.getByText('test@example.com')).toBeInTheDocument()
    })
    expect(screen.queryByRole('textbox', { name: /email/i })).toBeNull()
  })

  it('renders org name input pre-filled', async () => {
    renderWithProviders(<SettingsPage />)
    await waitFor(() => {
      const input = screen.getByLabelText(/organization name/i) as HTMLInputElement
      expect(input.value).toBe('Test Org')
    })
  })

  it('shows error when current password is wrong', async () => {
    server.use(
      http.patch('http://localhost:4000/api/v1/account/password', () =>
        HttpResponse.json({ message: 'Current password is incorrect' }, { status: 401 })
      )
    )
    renderWithProviders(<SettingsPage />)
    await waitFor(() => screen.getByLabelText(/current password/i))

    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'wrong' } })
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'newpass123' } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'newpass123' } })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect(screen.getByText('Current password is incorrect')).toBeInTheDocument()
    })
  })

  it('shows error when new passwords do not match', async () => {
    renderWithProviders(<SettingsPage />)
    await waitFor(() => screen.getByLabelText(/current password/i))

    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'correct' } })
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'newpass123' } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'different' } })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    })
  })

  it('clears password fields after successful change', async () => {
    renderWithProviders(<SettingsPage />)
    await waitFor(() => screen.getByLabelText(/current password/i))

    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'correct' } })
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'newpass123' } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'newpass123' } })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect((screen.getByLabelText(/current password/i) as HTMLInputElement).value).toBe('')
      expect((screen.getByLabelText(/new password/i) as HTMLInputElement).value).toBe('')
    })
  })

  it('submits org name change', async () => {
    renderWithProviders(<SettingsPage />)
    await waitFor(() => screen.getByLabelText(/organization name/i))

    const input = screen.getByLabelText(/organization name/i)
    fireEvent.change(input, { target: { value: 'New Org Name' } })
    fireEvent.click(screen.getByRole('button', { name: /save organization/i }))

    await waitFor(() => {
      expect(screen.queryByText(/saving/i)).toBeNull()
    })
  })
})
