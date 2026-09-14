import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithoutAuth, screen } from '@/test/test-utils'
import { toast } from 'sonner'
import { ApiKeysGettingStarted } from '@/components/api-keys-getting-started'
import type { ApiKeyListItem } from '@/lib/api/api-keys.api'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function makeKey(overrides: Partial<ApiKeyListItem> = {}): ApiKeyListItem {
  return {
    id: 'key_1',
    prefix: 'sk_live_6b89',
    name: 'allperms',
    organizationId: 'org_1',
    userId: 'user_1',
    scopes: ['email_inboxes:read'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

// jsdom's location for the ui test project (vitest.config.ts)
const JSDOM_ORIGIN = 'http://localhost:4000'

async function expandAndOpenTab(
  user: ReturnType<typeof renderWithoutAuth>['user'],
  tab?: 'SDK' | 'MCP',
) {
  await user.click(screen.getByText('Get started with the API'))
  if (tab) {
    await user.click(screen.getByRole('tab', { name: tab }))
  }
}

describe('ApiKeysGettingStarted', () => {
  afterEach(() => {
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it('renders collapsed by default', () => {
    renderWithoutAuth(<ApiKeysGettingStarted />)

    expect(screen.getByText('Get started with the API')).toBeInTheDocument()
    expect(screen.queryByText('API reference')).not.toBeInTheDocument()
  })

  it('expands to show the API tab (curl) by default, using the current origin', async () => {
    const { user } = renderWithoutAuth(<ApiKeysGettingStarted />)

    await expandAndOpenTab(user)

    expect(screen.getByText('API reference')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`curl ${JSDOM_ORIGIN}/api/v1/emailInbox`))).toBeInTheDocument()
  })

  it('uses the current origin in the MCP command too, not a hard-coded hosted URL', async () => {
    const { user } = renderWithoutAuth(<ApiKeysGettingStarted />)

    await expandAndOpenTab(user, 'MCP')

    expect(screen.getByText(new RegExp(`${JSDOM_ORIGIN}/api/mcp`))).toBeInTheDocument()
  })

  it('uses a key scoped for email_inboxes:read in the curl example when one exists', async () => {
    const { user } = renderWithoutAuth(
      <ApiKeysGettingStarted
        apiKeys={[
          makeKey({ id: 'key_1', prefix: 'sk_live_messageonly', scopes: ['email_messages:read'] }),
          makeKey({ id: 'key_2', prefix: 'sk_live_6b89', scopes: ['email_inboxes:read'] }),
        ]}
      />,
    )

    await expandAndOpenTab(user)

    expect(screen.getByText(/Bearer sk_live_6b89\.\.\./)).toBeInTheDocument()
    expect(screen.queryByText(/sk_live_messageonly/)).not.toBeInTheDocument()
  })

  it('falls back to a placeholder key when no key has email_inboxes:read', async () => {
    const { user } = renderWithoutAuth(
      <ApiKeysGettingStarted
        apiKeys={[makeKey({ scopes: ['email_messages:read'] })]}
      />,
    )

    await expandAndOpenTab(user)

    expect(screen.getByText(/Bearer sk_live_\.\.\./)).toBeInTheDocument()
  })

  it('switches to the SDK tab and defaults to Python', async () => {
    const { user } = renderWithoutAuth(<ApiKeysGettingStarted />)

    await expandAndOpenTab(user, 'SDK')

    expect(screen.getByText('pip install programmableinbox')).toBeInTheDocument()
    expect(screen.getByText('All SDKs')).toBeInTheDocument()
  })

  it('switches SDK language snippet when a language pill is clicked', async () => {
    const { user } = renderWithoutAuth(<ApiKeysGettingStarted />)

    await expandAndOpenTab(user, 'SDK')
    await user.click(screen.getByRole('button', { name: 'TypeScript' }))

    expect(screen.getByText('npm install @programmableinbox/sdk')).toBeInTheDocument()
    expect(screen.queryByText('pip install programmableinbox')).not.toBeInTheDocument()
  })

  it('switches to the MCP tab', async () => {
    const { user } = renderWithoutAuth(<ApiKeysGettingStarted />)

    await expandAndOpenTab(user, 'MCP')

    expect(screen.getByText(/claude mcp add --transport http programmableinbox/)).toBeInTheDocument()
    expect(screen.getByText('MCP setup guide')).toBeInTheDocument()
  })

  it('links out to the real docs site for each tab', async () => {
    const { user } = renderWithoutAuth(<ApiKeysGettingStarted />)

    await expandAndOpenTab(user)
    expect(screen.getByText('API reference').closest('a')).toHaveAttribute(
      'href',
      'https://docs.programmableinbox.com/api-reference/authentication-and-scopes',
    )

    await user.click(screen.getByRole('tab', { name: 'SDK' }))
    expect(screen.getByText('All SDKs').closest('a')).toHaveAttribute(
      'href',
      'https://docs.programmableinbox.com/sdks/overview',
    )

    await user.click(screen.getByRole('tab', { name: 'MCP' }))
    expect(screen.getByText('MCP setup guide').closest('a')).toHaveAttribute(
      'href',
      'https://docs.programmableinbox.com/mcp/setup',
    )
  })

  it('gives each copy button a distinct accessible name', async () => {
    const { user } = renderWithoutAuth(<ApiKeysGettingStarted />)

    await expandAndOpenTab(user, 'SDK')

    expect(screen.getByRole('button', { name: 'Copy Python install command' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy Python example' })).toBeInTheDocument()
  })

  it('copies the curl command to the clipboard and confirms via toast', async () => {
    const { user } = renderWithoutAuth(<ApiKeysGettingStarted />)

    await expandAndOpenTab(user)
    await user.click(screen.getByRole('button', { name: 'Copy curl command' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(`curl ${JSDOM_ORIGIN}/api/v1/emailInbox`),
    )
    expect(toast.success).toHaveBeenCalledWith('Copied to clipboard')
  })

  it('shows an error toast when the clipboard write is rejected', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
    const { user } = renderWithoutAuth(<ApiKeysGettingStarted />)

    await expandAndOpenTab(user)
    await user.click(screen.getByRole('button', { name: 'Copy curl command' }))

    expect(toast.error).toHaveBeenCalledWith("Couldn't copy to clipboard")
    expect(toast.success).not.toHaveBeenCalled()
  })
})
