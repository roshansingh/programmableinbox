/**
 * The create dialog is the client half of the inbox-domain policy (issue #98).
 *
 * It is convenience, not enforcement — `app/api/app/emailInbox/__tests__/
 * inbox-policy.test.ts` covers the server, which rejects the same inputs when a
 * request bypasses this UI entirely. What matters here is that the user cannot
 * type a domain at all, and that a rejection appears as an inline field error
 * rather than only a toast.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@/test/test-utils'
import { CreateEmailDialog } from '@/components/create-email-dialog'
import { server } from '@/test/mocks/server'
import { http, HttpResponse } from 'msw'
import { mockUser } from '@/test/mocks/fixtures/users'
import { setMockSessionCookie } from '@/test/mocks/session-cookie'

const BASE = 'http://localhost:4000/api'

/** Overrides the `/auth/me` config the AuthProvider fetches on mount. */
function withDomains(domains: string[]) {
  server.use(
    http.get(`${BASE}/app/auth/me`, () =>
      HttpResponse.json({
        data: { ...mockUser, config: { emailInboxDomains: domains } },
      }),
    ),
  )
}

/** Records every create attempt so "no network call" is a real assertion. */
function captureCreates() {
  const bodies: unknown[] = []
  server.use(
    http.post(`${BASE}/app/emailInbox`, async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json({ data: { id: 'inbox_new' } }, { status: 201 })
    }),
  )
  return bodies
}

function renderDialog(props: Partial<Parameters<typeof CreateEmailDialog>[0]> = {}) {
  return render(
    <CreateEmailDialog
      open
      onOpenChange={vi.fn()}
      organizationId="org-1"
      {...props}
    />,
  )
}

/** The dialog renders only after AuthProvider resolves the config. */
async function localPartInput() {
  return waitFor(() => screen.getByLabelText(/email address/i))
}

beforeEach(() => {
  setMockSessionCookie()
})

describe('CreateEmailDialog — exactly one configured domain', () => {
  beforeEach(() => withDomains(['inbox.example.com']))

  it('renders the domain as a fixed suffix', async () => {
    renderDialog()

    expect(await screen.findByText('@inbox.example.com')).toBeInTheDocument()
  })

  it('offers no dropdown, because there is nothing to choose', async () => {
    renderDialog()
    await localPartInput()

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('exposes the domain in the field’s accessible name', async () => {
    renderDialog()

    expect(await screen.findByLabelText(/inbox\.example\.com/)).toBeInTheDocument()
  })

  it('submits the local part joined to the fixed domain', async () => {
    const bodies = captureCreates()
    const { user } = renderDialog()

    await user.type(await localPartInput(), 'qa-team')
    await user.click(screen.getByRole('button', { name: /create email/i }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({
      organizationId: 'org-1',
      email: 'qa-team@inbox.example.com',
    })
  })

  it('never lets the user type a domain — an @ in the local part is rejected', async () => {
    const bodies = captureCreates()
    const { user } = renderDialog()

    await user.type(await localPartInput(), 'qa@gmail.com')
    await user.click(screen.getByRole('button', { name: /create email/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })
})

describe('CreateEmailDialog — two or more configured domains', () => {
  beforeEach(() => withDomains(['inbox.example.com', 'mail.example.com']))

  it('renders a domain picker defaulting to the first entry', async () => {
    renderDialog()

    const picker = await screen.findByRole('combobox')
    expect(within(picker).getByText('@inbox.example.com')).toBeInTheDocument()
  })

  it('submits against the selected domain, not the default', async () => {
    const bodies = captureCreates()
    const { user } = renderDialog()

    await user.type(await localPartInput(), 'qa-team')
    await user.click(await screen.findByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: '@mail.example.com' }))
    await user.click(screen.getByRole('button', { name: /create email/i }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ email: 'qa-team@mail.example.com' })
  })

  it('lists every configured domain as an option', async () => {
    const { user } = renderDialog()

    await user.click(await screen.findByRole('combobox'))

    expect(await screen.findByRole('option', { name: '@inbox.example.com' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '@mail.example.com' })).toBeInTheDocument()
  })
})

describe('CreateEmailDialog — no configured domain', () => {
  beforeEach(() => withDomains([]))

  it('explains that creation is unavailable', async () => {
    renderDialog()

    expect(
      await screen.findByText(/not configured — contact your administrator/i),
    ).toBeInTheDocument()
  })

  it('disables the address field and the create button', async () => {
    renderDialog()

    expect(await localPartInput()).toBeDisabled()
    expect(screen.getByRole('button', { name: /create email/i })).toBeDisabled()
  })
})

describe('CreateEmailDialog — inline validation blocks submission', () => {
  beforeEach(() => withDomains(['inbox.example.com']))

  it.each([
    ['amazon-security', 'embedded brand'],
    ['g00gle', 'leetspeak'],
    ['pi-support', 'platform self-impersonation'],
    ['billing', 'staff-sounding term'],
  ])('rejects %s (%s) without a network call', async (localPart) => {
    const bodies = captureCreates()
    const { user } = renderDialog()

    await user.type(await localPartInput(), localPart)
    await user.click(screen.getByRole('button', { name: /create email/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /resembles a brand or system address/i,
    )
    expect(bodies).toHaveLength(0)
  })

  it('reports the error inline on the field, not only as a toast', async () => {
    const { user } = renderDialog()

    await user.type(await localPartInput(), 'amazon')
    await user.click(screen.getByRole('button', { name: /create email/i }))

    const input = await localPartInput()
    const alert = await screen.findByRole('alert')

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(alert.id)
  })

  it('rejects a blocked display name', async () => {
    const bodies = captureCreates()
    const { user } = renderDialog()

    await user.type(await localPartInput(), 'qa-team')
    await user.type(screen.getByLabelText(/display name/i), 'Amazon Support')
    await user.click(screen.getByRole('button', { name: /create email/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /resembles a brand or system name/i,
    )
    expect(bodies).toHaveLength(0)
  })

  it('rejects an over-long display name without a round-trip to the server', async () => {
    // The server caps it at 100 and answers 400. Checking here too turns an
    // avoidable request into an inline error.
    const bodies = captureCreates()
    const { user } = renderDialog()

    await user.type(await localPartInput(), 'qa-team')
    // paste rather than type: 101 keystrokes is needlessly slow
    await user.click(screen.getByLabelText(/display name/i))
    await user.paste('a'.repeat(101))
    await user.click(screen.getByRole('button', { name: /create email/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/100 characters or fewer/i)
    expect(bodies).toHaveLength(0)
  })

  it('accepts a display name exactly at the limit', async () => {
    const bodies = captureCreates()
    const { user } = renderDialog()

    await user.type(await localPartInput(), 'qa-team')
    await user.click(screen.getByLabelText(/display name/i))
    await user.paste('a'.repeat(100))
    await user.click(screen.getByRole('button', { name: /create email/i }))

    await waitFor(() => expect(bodies).toHaveLength(1))
  })

  it('rejects an over-long local part without a round-trip to the server', async () => {
    const bodies = captureCreates()
    const { user } = renderDialog()

    await user.click(await localPartInput())
    await user.paste('a'.repeat(51))
    await user.click(screen.getByRole('button', { name: /create email/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/50 characters or fewer/i)
    expect(bodies).toHaveLength(0)
  })

  it('accepts a local part exactly at the limit', async () => {
    const bodies = captureCreates()
    const { user } = renderDialog()

    await user.click(await localPartInput())
    await user.paste('a'.repeat(50))
    await user.click(screen.getByRole('button', { name: /create email/i }))

    await waitFor(() => expect(bodies).toHaveLength(1))
  })

  it('rejects a non-ASCII display name, which the term list alone misses', async () => {
    const bodies = captureCreates()
    const { user } = renderDialog()

    await user.type(await localPartInput(), 'qa-team')
    await user.type(screen.getByLabelText(/display name/i), 'Аmazon')
    await user.click(screen.getByRole('button', { name: /create email/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('clears the error once the user corrects the value', async () => {
    const { user } = renderDialog()
    const input = await localPartInput()

    await user.type(input, 'amazon')
    await user.click(screen.getByRole('button', { name: /create email/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, 'qa-team')

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('requires a local part, and says so inline', async () => {
    const bodies = captureCreates()
    const { user } = renderDialog()

    await user.click(await localPartInput())
    await user.click(screen.getByRole('button', { name: /create email/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/required/i)
    expect(bodies).toHaveLength(0)
  })

  it('replaces a stale message when the reason changes but stays an error', async () => {
    const { user } = renderDialog()

    await user.click(screen.getByRole('button', { name: /create email/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/required/i)

    await user.type(await localPartInput(), 'amazon')
    await user.click(screen.getByRole('button', { name: /create email/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/resembles a brand/i)
  })

  it('describes only the field the error belongs to', async () => {
    const { user } = renderDialog()

    await user.type(await localPartInput(), 'qa-team')
    await user.type(screen.getByLabelText(/display name/i), 'Amazon Support')
    await user.click(screen.getByRole('button', { name: /create email/i }))

    const alert = await screen.findByRole('alert')
    const nameInput = screen.getByLabelText(/display name/i)

    expect(nameInput.getAttribute('aria-describedby')).toContain(alert.id)
    // The address is fine here, so it must not be announced as the problem.
    expect((await localPartInput()).getAttribute('aria-describedby') ?? '').not.toContain(
      alert.id,
    )
  })
})

describe('CreateEmailDialog — server rejection', () => {
  beforeEach(() => withDomains(['inbox.example.com']))

  function rejectWith(status: number, message: string) {
    server.use(
      http.post(`${BASE}/app/emailInbox`, () =>
        HttpResponse.json({ message }, { status }),
      ),
    )
  }

  it('shows the server’s rejection inline', async () => {
    rejectWith(409, 'Email address is not available')
    const { user } = renderDialog()

    await user.type(await localPartInput(), 'qa-team')
    await user.click(screen.getByRole('button', { name: /create email/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not available/i)
  })

  /**
   * The client cannot recompute a server-side verdict (address already taken,
   * a term only the server knows), so nothing invalidates it except the user
   * changing the input. Without that, the rejection is stuck on screen with no
   * way to clear it short of resubmitting.
   */
  it('clears the server’s rejection once the user edits the address', async () => {
    rejectWith(409, 'Email address is not available')
    const { user } = renderDialog()
    const input = await localPartInput()

    await user.type(input, 'qa-team')
    await user.click(screen.getByRole('button', { name: /create email/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/not available/i)

    await user.type(input, '-2')

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('clears the server’s rejection once the user edits the display name', async () => {
    rejectWith(422, 'That display name is not available')
    const { user } = renderDialog()

    await user.type(await localPartInput(), 'qa-team')
    await user.click(screen.getByRole('button', { name: /create email/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/display name/i), 'QA')

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})

describe('CreateEmailDialog — cancel', () => {
  beforeEach(() => withDomains(['inbox.example.com']))

  it('discards the rejected input so reopening starts clean', async () => {
    const onOpenChange = vi.fn()
    const { user } = renderDialog({ onOpenChange })

    await user.type(await localPartInput(), 'amazon')
    await user.click(screen.getByRole('button', { name: /create email/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(await localPartInput()).toHaveValue('')
  })
})
