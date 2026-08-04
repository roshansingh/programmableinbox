import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const requestMock = vi.fn()

vi.mock('@/lib/api/auth.api', () => ({
  requestPasswordReset: (...args: unknown[]) => requestMock(...args),
}))

import ForgotPasswordPage from '../page'

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    requestMock.mockReset()
    requestMock.mockResolvedValue({ requested: true })
  })

  it('submits the address and shows a confirmation that does not confirm existence', async () => {
    render(<ForgotPasswordPage />)

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('user@example.com'))
    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument()
  })

  it('shows the same confirmation when the request fails', async () => {
    requestMock.mockRejectedValue(new Error('network'))
    render(<ForgotPasswordPage />)

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument()
  })

  it('shows the same confirmation for a 500, not the unavailable state', async () => {
    requestMock.mockRejectedValue({ status: 500, message: 'Internal Server Error' })
    render(<ForgotPasswordPage />)

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument()
    expect(screen.queryByText(/isn't available/i)).not.toBeInTheDocument()
  })

  it('renders an honest unavailable state on a 404, not the enumeration-safe confirmation', async () => {
    requestMock.mockRejectedValue({ status: 404, message: 'Not found' })
    render(<ForgotPasswordPage />)

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByText(/isn't available/i)).toBeInTheDocument()
    expect(screen.queryByText(/if an account exists/i)).not.toBeInTheDocument()
  })

  it('links back to sign in', () => {
    render(<ForgotPasswordPage />)

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/auth/login',
    )
  })
})
