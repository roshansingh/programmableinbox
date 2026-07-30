import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { Sidebar } from '@/components/sidebar'
import type { User } from '@/lib/api/auth.api'

const mockUser = vi.hoisted(() => ({ current: null as User | null }))

vi.mock('@/components/auth-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/auth-provider')>()
  return {
    ...actual,
    useAuth: () => ({
      user: mockUser.current,
      organizationId: mockUser.current?.organizations?.[0]?.id ?? null,
      isLoading: false,
      isAuthenticated: !!mockUser.current,
      refreshUser: vi.fn(),
    }),
  }
})

function makeUser(overrides: Partial<User> = {}): User {
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
    ...overrides,
  }
}

describe('Sidebar', () => {
  it('renders the signed-in user name, email and initials in the footer', () => {
    mockUser.current = makeUser()
    render(<Sidebar />)

    expect(screen.getByText('Roshan Singh', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('roshan@example.com')).toBeInTheDocument()
    expect(screen.getByText('RS')).toBeInTheDocument()
  })

  it('never renders placeholder identity data', () => {
    mockUser.current = makeUser()
    render(<Sidebar />)

    expect(screen.queryByText('John Doe')).not.toBeInTheDocument()
    expect(screen.queryByText('john@example.com')).not.toBeInTheDocument()
  })

  it('falls back to the email local part when the user has no name', () => {
    mockUser.current = makeUser({ firstName: undefined, lastName: undefined })
    render(<Sidebar />)

    expect(screen.getByText('roshan', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('RO')).toBeInTheDocument()
  })

  it('renders the organization name from the user payload', () => {
    mockUser.current = makeUser({
      organizations: [
        {
          id: 'org_2',
          name: 'Acme Inc',
          slug: 'acme-inc',
          role: 'owner',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    render(<Sidebar />)

    expect(screen.getByText('Acme Inc')).toBeInTheDocument()
  })

  it('shows a skeleton instead of fake data while the user is loading', () => {
    mockUser.current = null
    render(<Sidebar />)

    expect(screen.queryByText('John Doe')).not.toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })
})
