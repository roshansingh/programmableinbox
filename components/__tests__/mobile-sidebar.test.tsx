import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { MobileSidebar } from '@/components/mobile-sidebar'
import type { User, OrganizationPlan } from '@/lib/api/auth.api'

const mockUser = vi.hoisted(() => ({ current: null as User | null }))
const mockPlan = vi.hoisted(() => ({ current: null as OrganizationPlan | null }))

vi.mock('@/components/auth-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/auth-provider')>()
  return {
    ...actual,
    useAuth: () => ({
      user: mockUser.current,
      organizationId: mockUser.current?.organizations?.[0]?.id ?? null,
      plan: mockPlan.current,
      isLoading: false,
      isAuthenticated: !!mockUser.current,
      refreshUser: vi.fn(),
    }),
  }
})

function makeUser(): User {
  return {
    id: 'user_1',
    email: 'roshan@example.com',
    firstName: 'Roshan',
    lastName: 'Singh',
    emailVerified: true,
    organizations: [
      {
        id: 'org_1',
        name: 'Roshan Singh',
        slug: 'roshan-singh',
        role: 'owner',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }
}

describe('MobileSidebar Billing link', () => {
  it('is absent when the organization has no plan', () => {
    mockUser.current = makeUser()
    mockPlan.current = null
    render(<MobileSidebar open onClose={() => {}} />)

    expect(screen.queryByText('Billing')).not.toBeInTheDocument()
  })

  it('links to /billing when the organization has a plan', () => {
    mockUser.current = makeUser()
    mockPlan.current = { code: 'free', name: 'Free', limits: {} as never }
    render(<MobileSidebar open onClose={() => {}} />)

    expect(screen.getByText('Billing').closest('a')).toHaveAttribute('href', '/billing')
  })

  it('sits directly above Settings', () => {
    mockUser.current = makeUser()
    mockPlan.current = { code: 'free', name: 'Free', limits: {} as never }
    render(<MobileSidebar open onClose={() => {}} />)

    const labels = screen.getAllByRole('link').map((link) => link.textContent)
    expect(labels.indexOf('Billing')).toBe(labels.indexOf('Settings') - 1)
  })
})
