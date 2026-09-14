import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SupportPage from '../page'

// Mock Sidebar and DashboardHeader since they have their own dependencies
// (auth context, org data) that this static page doesn't need.
vi.mock('@/components/sidebar', () => ({
  Sidebar: () => <nav data-testid="sidebar">Sidebar</nav>,
}))

vi.mock('@/components/dashboard-header', () => ({
  DashboardHeader: () => <header data-testid="dashboard-header">Header</header>,
}))

describe('SupportPage', () => {
  it('shows the support email as a mailto link', () => {
    render(<SupportPage />)

    const link = screen.getByRole('link', { name: /support@programmableinbox\.com/i })
    expect(link).toHaveAttribute('href', 'mailto:support@programmableinbox.com')
  })

  it('tells the user how quickly support usually replies', () => {
    render(<SupportPage />)

    expect(screen.getByText(/repl(y|ies) within (about )?6 hours/i)).toBeInTheDocument()
  })
})
