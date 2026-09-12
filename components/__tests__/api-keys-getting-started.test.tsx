import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { ApiKeysGettingStarted } from '@/components/api-keys-getting-started'

describe('ApiKeysGettingStarted', () => {
  it('renders collapsed by default', () => {
    render(<ApiKeysGettingStarted />)

    expect(screen.getByText('Get started with the API')).toBeInTheDocument()
    expect(screen.queryByText('API reference')).not.toBeInTheDocument()
  })

  it('expands to show the API tab (curl) by default', async () => {
    const { user } = render(<ApiKeysGettingStarted />)

    await user.click(screen.getByText('Get started with the API'))

    expect(screen.getByText('API reference')).toBeInTheDocument()
    expect(screen.getByText(/curl https:\/\/app.programmableinbox.com\/api\/v1\/emailInbox/)).toBeInTheDocument()
  })

  it('uses the real key prefix in the curl example when one is provided', async () => {
    const { user } = render(<ApiKeysGettingStarted examplePrefix="sk_live_6b89" />)

    await user.click(screen.getByText('Get started with the API'))

    expect(screen.getByText(/Bearer sk_live_6b89\.\.\./)).toBeInTheDocument()
  })

  it('falls back to a placeholder key when no key exists yet', async () => {
    const { user } = render(<ApiKeysGettingStarted />)

    await user.click(screen.getByText('Get started with the API'))

    expect(screen.getByText(/Bearer sk_live_\.\.\./)).toBeInTheDocument()
  })

  it('switches to the SDK tab and defaults to Python', async () => {
    const { user } = render(<ApiKeysGettingStarted />)

    await user.click(screen.getByText('Get started with the API'))
    await user.click(screen.getByRole('tab', { name: 'SDK' }))

    expect(screen.getByText('pip install programmableinbox')).toBeInTheDocument()
    expect(screen.getByText('All SDKs')).toBeInTheDocument()
  })

  it('switches SDK language snippet when a language pill is clicked', async () => {
    const { user } = render(<ApiKeysGettingStarted />)

    await user.click(screen.getByText('Get started with the API'))
    await user.click(screen.getByRole('tab', { name: 'SDK' }))
    await user.click(screen.getByRole('button', { name: 'TypeScript' }))

    expect(screen.getByText('npm install @programmableinbox/sdk')).toBeInTheDocument()
    expect(screen.queryByText('pip install programmableinbox')).not.toBeInTheDocument()
  })

  it('switches to the MCP tab', async () => {
    const { user } = render(<ApiKeysGettingStarted />)

    await user.click(screen.getByText('Get started with the API'))
    await user.click(screen.getByRole('tab', { name: 'MCP' }))

    expect(screen.getByText(/claude mcp add --transport http programmableinbox/)).toBeInTheDocument()
    expect(screen.getByText('MCP setup guide')).toBeInTheDocument()
  })

  it('links out to the real docs site for each tab', async () => {
    const { user } = render(<ApiKeysGettingStarted />)

    await user.click(screen.getByText('Get started with the API'))
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
})
