/**
 * The create dialog is the client half of real number provisioning (issue #141).
 *
 * It is convenience, not enforcement: the server validates the same inputs and
 * is the only thing that can actually buy a number. What matters here is that a
 * user can no longer type a phone number at all — they search an area code and
 * pick from what Twilio offers — and that the cost of the action is stated.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import { CreatePhoneDialog } from '@/components/create-phone-dialog'
import { server } from '@/test/mocks/server'
import { http, HttpResponse } from 'msw'
import { setMockSessionCookie } from '@/test/mocks/session-cookie'

const BASE = 'http://localhost:4000/api'

function renderDialog(props: Partial<Parameters<typeof CreatePhoneDialog>[0]> = {}) {
  const onOpenChange = vi.fn()
  const onSuccess = vi.fn()
  const view = render(
    <CreatePhoneDialog
      open
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
      organizationId="org-1"
      {...props}
    />,
  )
  return { ...view, onOpenChange, onSuccess }
}

/** Records every create attempt so "no network call" is a real assertion. */
function captureCreates(respond?: () => Response) {
  const bodies: unknown[] = []
  server.use(
    http.post(`${BASE}/app/phoneInbox`, async ({ request }) => {
      bodies.push(await request.json())
      return respond ? respond() : HttpResponse.json({ data: { id: 'phone-new' } }, { status: 201 })
    }),
  )
  return bodies
}

function captureSearches() {
  const queries: Record<string, string>[] = []
  server.use(
    http.get(`${BASE}/app/phoneInbox/available`, ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams))
      return HttpResponse.json({
        data: [
          { phoneNumber: '+14155550100', locality: 'San Francisco', region: 'CA' },
          { phoneNumber: '+14155550101', locality: 'Oakland', region: 'CA' },
        ],
      })
    }),
  )
  return queries
}

const searchButton = () => screen.getByRole('button', { name: /search/i })
const createButton = () => screen.getByRole('button', { name: /buy|create/i })

beforeEach(() => {
  setMockSessionCookie()
})

describe('CreatePhoneDialog', () => {
  it('has no free-text phone number field', () => {
    renderDialog()
    expect(screen.queryByLabelText(/^phone number/i)).not.toBeInTheDocument()
  })

  it('offers only the United States and Canada', async () => {
    const { user } = renderDialog()

    await user.click(screen.getByRole('combobox', { name: /country/i }))

    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options).toEqual(['United States (US)', 'Canada (CA)'])
  })

  it('keeps Search disabled until the area code is exactly three digits, and strips anything else', async () => {
    const { user } = renderDialog()
    const input = screen.getByLabelText(/area code/i)

    await user.type(input, '41')
    expect(searchButton()).toBeDisabled()

    await user.clear(input)
    await user.type(input, '4a1b5')
    expect(input).toHaveValue('415')
    expect(searchButton()).toBeEnabled()
  })

  it('searches the chosen country and area code and lists what Twilio offers', async () => {
    const queries = captureSearches()
    const { user } = renderDialog()

    await user.type(screen.getByLabelText(/area code/i), '415')
    await user.click(searchButton())

    expect(await screen.findByText('+1 (415) 555-0100')).toBeInTheDocument()
    expect(screen.getByText('+1 (415) 555-0101')).toBeInTheDocument()
    expect(screen.getByText(/San Francisco/)).toBeInTheDocument()
    expect(queries).toEqual([{ organizationId: 'org-1', country: 'US', areaCode: '415' }])
  })

  it('says so when nothing is available in that area code', async () => {
    server.use(http.get(`${BASE}/app/phoneInbox/available`, () => HttpResponse.json({ data: [] })))
    const { user } = renderDialog()

    await user.type(screen.getByLabelText(/area code/i), '999')
    await user.click(searchButton())

    expect(await screen.findByText(/no numbers available/i)).toBeInTheDocument()
  })

  it('keeps the buy button disabled until a number is chosen', async () => {
    captureSearches()
    const { user } = renderDialog()
    await user.type(screen.getByLabelText(/area code/i), '415')
    await user.click(searchButton())
    await screen.findByText('+1 (415) 555-0100')

    expect(createButton()).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: /555-0101/ }))
    expect(createButton()).toBeEnabled()
  })

  it('buys the chosen E.164 number for the organization, then closes and refreshes', async () => {
    captureSearches()
    const bodies = captureCreates()
    const { user, onOpenChange, onSuccess } = renderDialog()
    await user.type(screen.getByLabelText(/area code/i), '415')
    await user.click(searchButton())
    await user.click(await screen.findByRole('radio', { name: /555-0101/ }))

    await user.click(createButton())

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(bodies).toEqual([{ organizationId: 'org-1', phoneNumber: '+14155550101', countryCode: 'US' }])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('states that a real number is bought and that deleting releases it for good', () => {
    renderDialog()
    expect(screen.getByText(/real phone number/i)).toBeInTheDocument()
    expect(screen.getByText(/releas/i)).toBeInTheDocument()
  })

  it('drops a number that was taken, shows why, and does not search again by itself', async () => {
    const queries = captureSearches()
    captureCreates(() =>
      HttpResponse.json({ message: 'That number is no longer available' }, { status: 409 }),
    )
    const { user, onSuccess } = renderDialog()
    await user.type(screen.getByLabelText(/area code/i), '415')
    await user.click(searchButton())
    await user.click(await screen.findByRole('radio', { name: /555-0100/ }))

    await user.click(createButton())

    expect(await screen.findByText('That number is no longer available')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('+1 (415) 555-0100')).not.toBeInTheDocument())
    expect(screen.getByText('+1 (415) 555-0101')).toBeInTheDocument()
    expect(createButton()).toBeDisabled()
    expect(queries).toHaveLength(1)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('shows the server message when the plan does not allow phone inboxes', async () => {
    captureSearches()
    captureCreates(() =>
      HttpResponse.json({ message: 'Phone inboxes are not included in your Free plan.' }, { status: 402 }),
    )
    const { user } = renderDialog()
    await user.type(screen.getByLabelText(/area code/i), '415')
    await user.click(searchButton())
    await user.click(await screen.findByRole('radio', { name: /555-0100/ }))

    await user.click(createButton())

    expect(await screen.findByText(/not included in your Free plan/)).toBeInTheDocument()
  })

  it('surfaces a failed search instead of an empty list', async () => {
    server.use(
      http.get(`${BASE}/app/phoneInbox/available`, () =>
        HttpResponse.json({ message: 'SMS is not enabled on this deployment' }, { status: 503 }),
      ),
    )
    const { user } = renderDialog()

    await user.type(screen.getByLabelText(/area code/i), '415')
    await user.click(searchButton())

    expect(await screen.findByText('SMS is not enabled on this deployment')).toBeInTheDocument()
    expect(screen.queryByText(/no numbers available/i)).not.toBeInTheDocument()
  })
})
