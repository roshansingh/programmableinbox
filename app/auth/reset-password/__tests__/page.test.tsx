import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const confirmMock = vi.fn()
const pushMock = vi.fn()
let searchParams = new URLSearchParams('token=tok123')

vi.mock('@/lib/api/auth.api', () => ({
  confirmPasswordReset: (...args: unknown[]) => confirmMock(...args),
}))

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('next/navigation')
  return {
    ...actual,
    useRouter: () => ({ push: pushMock }),
    useSearchParams: () => searchParams,
  }
})

import ResetPasswordPage from '../page'

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    confirmMock.mockReset()
    pushMock.mockReset()
    confirmMock.mockResolvedValue({ reset: true })
    searchParams = new URLSearchParams('token=tok123')
    window.history.replaceState(null, '', '/auth/reset-password?token=tok123')
  })

  it('scrubs the token from the URL on mount', async () => {
    render(<ResetPasswordPage />)

    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('does not redeem the token on mount — only on submit', () => {
    render(<ResetPasswordPage />)

    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('submits the new password and sends the user to sign in', async () => {
    render(<ResetPasswordPage />)

    await userEvent.type(screen.getByLabelText(/^new password$/i), 'new-password-1')
    await userEvent.type(screen.getByLabelText(/confirm/i), 'new-password-1')
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith('tok123', 'new-password-1'))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/auth/login'))
  })

  it('rejects a mismatched confirmation without calling the API', async () => {
    render(<ResetPasswordPage />)

    await userEvent.type(screen.getByLabelText(/^new password$/i), 'new-password-1')
    await userEvent.type(screen.getByLabelText(/confirm/i), 'different-1')
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }))

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument()
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('rejects a short password without calling the API', async () => {
    render(<ResetPasswordPage />)

    await userEvent.type(screen.getByLabelText(/^new password$/i), 'short')
    await userEvent.type(screen.getByLabelText(/confirm/i), 'short')
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }))

    expect(await screen.findByText(/at least 8/i)).toBeInTheDocument()
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('surfaces the server message when the link is rejected', async () => {
    confirmMock.mockRejectedValue(new Error('This reset link has expired'))
    render(<ResetPasswordPage />)

    await userEvent.type(screen.getByLabelText(/^new password$/i), 'new-password-1')
    await userEvent.type(screen.getByLabelText(/confirm/i), 'new-password-1')
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }))

    expect(await screen.findByText(/has expired/i)).toBeInTheDocument()
  })

  it('tells the user the link is unusable when there is no token', async () => {
    searchParams = new URLSearchParams('')
    render(<ResetPasswordPage />)

    expect(await screen.findByText(/not valid/i)).toBeInTheDocument()
  })
})
