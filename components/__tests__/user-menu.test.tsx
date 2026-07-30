import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { UserMenu } from '@/components/user-menu'
import { logout } from '@/lib/api/auth.api'
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

vi.mock('@/lib/api/auth.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/auth.api')>()
  return { ...actual, logout: vi.fn() }
})

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user_1',
    email: 'roshan@example.com',
    firstName: 'Roshan',
    lastName: 'Singh',
    emailVerified: true,
    organizations: [],
    ...overrides,
  }
}

const originalLocation = window.location

beforeEach(() => {
  mockUser.current = makeUser()
  vi.mocked(logout).mockClear()
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...originalLocation, href: 'http://localhost/emails' },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  })
})

describe('UserMenu', () => {
  it('renders the signed-in user in the trigger', () => {
    render(<UserMenu />)

    expect(screen.getByText('Roshan Singh')).toBeInTheDocument()
    expect(screen.getByText('roshan@example.com')).toBeInTheDocument()
    expect(screen.getByText('RS')).toBeInTheDocument()
  })

  it('opens the menu and exposes a log out item', async () => {
    const user = userEvent.setup()
    render(<UserMenu />)

    expect(screen.queryByRole('menuitem', { name: /log out/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /roshan singh/i }))

    expect(await screen.findByRole('menuitem', { name: /log out/i })).toBeInTheDocument()
  })

  it('clears the session and navigates to login on log out', async () => {
    const user = userEvent.setup()
    render(<UserMenu />)

    await user.click(screen.getByRole('button', { name: /roshan singh/i }))
    await user.click(await screen.findByRole('menuitem', { name: /log out/i }))

    expect(logout).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('/auth/login')
  })

  it('runs onBeforeLogout before navigating, so the mobile sheet can close', async () => {
    const user = userEvent.setup()
    const onBeforeLogout = vi.fn()
    render(<UserMenu onBeforeLogout={onBeforeLogout} />)

    await user.click(screen.getByRole('button', { name: /roshan singh/i }))
    await user.click(await screen.findByRole('menuitem', { name: /log out/i }))

    expect(onBeforeLogout).toHaveBeenCalledTimes(1)
  })

  it('renders a skeleton and no trigger while the user is loading', () => {
    mockUser.current = null
    render(<UserMenu />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument()
  })
})
