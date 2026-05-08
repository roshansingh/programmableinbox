import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import MockLink from './mocks/next-link'
import { server } from './mocks/server'

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

beforeEach(() => {
  const clipboard = navigator.clipboard ?? ({} as Navigator['clipboard'])

  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
  })

  Object.assign(navigator.clipboard, {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  })
})

// Reset handlers and clean up after each test
afterEach(() => {
  server.resetHandlers()
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

// Stop MSW server after all tests
afterAll(() => server.close())

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  })),
  usePathname: vi.fn(() => '/emails'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useParams: vi.fn(() => ({})),
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: MockLink,
}))

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock window.confirm to return true by default
vi.stubGlobal('confirm', vi.fn(() => true))
