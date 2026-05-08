import React from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider } from '@/components/auth-provider'
import { Toaster } from 'sonner'

function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Toaster />
      {children}
    </AuthProvider>
  )
}

function customRender(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  const user = userEvent.setup({ writeToClipboard: false })
  return {
    user,
    ...render(ui, { wrapper: AllProviders, ...options }),
  }
}

function renderWithoutAuth(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  const user = userEvent.setup({ writeToClipboard: false })
  return {
    user,
    ...render(ui, options),
  }
}

// Re-export everything from testing-library
export * from '@testing-library/react'

// Override render with our custom version
export { customRender as render, renderWithoutAuth }
