import { describe, it, expect, beforeEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { useParams } from 'next/navigation'
import { render, screen, waitFor, within } from '@/test/test-utils'
import { server } from '@/test/mocks/server'
import PhoneMessagesPage from '@/app/phones/[id]/page'

vi.mock('@/components/sidebar', () => ({ Sidebar: () => <nav>Sidebar</nav> }))
vi.mock('@/components/mobile-sidebar', () => ({ MobileSidebar: () => null }))
vi.mock('@/components/dashboard-header', () => ({ DashboardHeader: () => <header>Header</header> }))

const BASE = 'http://localhost:4000/api'
const INBOX_ID = 'inbox_1'
const NUMBER = '+14155550100'

const inbox = {
  id: INBOX_ID,
  organizationId: 'org_1',
  phoneNumber: NUMBER,
  countryCode: 'US',
  status: 'active',
  capabilities: { sms: true, mms: false, voice: false },
  isOwner: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
}

function message(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    phoneInboxId: INBOX_ID,
    from: '32665',
    to: NUMBER,
    body: 'Your code is 481516',
    mediaCount: 0,
    threadId: `${INBOX_ID}:32665`,
    extractedOtp: null,
    isRead: false,
    createdAt: '2026-11-02T10:00:00.000Z',
    ...over,
  }
}

function thread(over: Record<string, unknown> = {}) {
  return { ...message(), threadCount: 1, unreadCount: 1, ...over }
}

let patchBodies: unknown[]
let threadRequests: string[]

function serve(opts: {
  threads?: unknown[]
  hasMore?: boolean
  nextCursor?: string | null
  /** The newest page of a thread, newest first, as the API returns it. */
  messages?: unknown[]
  messagesHasMore?: boolean
  /** What `?threadId=&cursor=` returns: the next-older page, newest first. */
  olderMessages?: unknown[]
  /** Threads on the second page of the list. */
  pageTwoThreads?: unknown[]
  /** Holds the second page of the list back until released. */
  pageTwoGate?: Promise<void>
} = {}) {
  server.use(
    http.get(`${BASE}/app/phoneInbox/${INBOX_ID}`, () => HttpResponse.json({ data: inbox })),
    http.get(`${BASE}/app/phoneInbox/${INBOX_ID}/messages`, async ({ request }) => {
      const url = new URL(request.url)
      threadRequests.push(url.search)
      if (url.searchParams.get('threadId')) {
        if (url.searchParams.get('cursor')) {
          return HttpResponse.json({
            data: { messages: opts.olderMessages ?? [], nextCursor: null, hasMore: false },
          })
        }
        return HttpResponse.json({
          data: {
            messages: opts.messages ?? [message()],
            nextCursor: opts.messagesHasMore ? 'OLDER1' : null,
            hasMore: opts.messagesHasMore ?? false,
          },
        })
      }
      const cursor = url.searchParams.get('cursor')
      if (cursor) {
        await opts.pageTwoGate
        return HttpResponse.json({
          data: {
            threads: opts.pageTwoThreads ?? [
              thread({ id: 'm9', from: '99999', threadId: `${INBOX_ID}:99999`, body: 'older thread' }),
            ],
            nextCursor: null,
            hasMore: false,
          },
        })
      }
      return HttpResponse.json({
        data: {
          threads: opts.threads ?? [thread()],
          nextCursor: opts.nextCursor ?? null,
          hasMore: opts.hasMore ?? false,
        },
      })
    }),
    http.patch(`${BASE}/app/phoneInbox/${INBOX_ID}/messages`, async ({ request }) => {
      patchBodies.push(await request.json())
      return HttpResponse.json({ data: { updated: 1 } })
    }),
  )
}

beforeEach(() => {
  patchBodies = []
  threadRequests = []
  // jsdom has no ResizeObserver, which Radix ScrollArea needs on mount.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.mocked(useParams).mockReturnValue({ id: INBOX_ID })
})

describe('PhoneMessagesPage', () => {
  it("shows the inbox's real number and its threads from the API", async () => {
    serve({
      threads: [
        thread({ unreadCount: 2, threadCount: 3 }),
        thread({ id: 'm2', from: '+14155550199', threadId: `${INBOX_ID}:+14155550199`, body: 'hello there', unreadCount: 0 }),
      ],
    })

    render(<PhoneMessagesPage />)

    expect(await screen.findByText(NUMBER)).toBeInTheDocument()
    expect(await screen.findByText('Your code is 481516')).toBeInTheDocument()
    expect(screen.getByText('hello there')).toBeInTheDocument()
    expect(screen.getByLabelText('2 unread')).toBeInTheDocument()
    expect(screen.queryByText('Bank of America')).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing has arrived yet', async () => {
    serve({ threads: [] })

    render(<PhoneMessagesPage />)

    expect(await screen.findByText(/no messages yet/i)).toBeInTheDocument()
  })

  it('says so when the messages cannot be loaded', async () => {
    server.use(
      http.get(`${BASE}/app/phoneInbox/${INBOX_ID}`, () => HttpResponse.json({ data: inbox })),
      http.get(`${BASE}/app/phoneInbox/${INBOX_ID}/messages`, () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    )

    render(<PhoneMessagesPage />)

    expect(await screen.findByText(/could not load messages/i)).toBeInTheDocument()
  })

  it("loads a thread's messages when it is selected, oldest at the top, and marks it read", async () => {
    // The API sends newest first; the page shows a conversation top to bottom.
    serve({
      messages: [
        message({ id: 'b', body: 'second text', createdAt: '2026-11-02T10:00:00.000Z' }),
        message({ id: 'a', body: 'first text', createdAt: '2026-11-02T09:00:00.000Z' }),
      ],
    })
    const { user } = render(<PhoneMessagesPage />)

    await user.click(await screen.findByText('Your code is 481516'))

    const first = await screen.findByText('first text')
    const second = screen.getByText('second text')
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() =>
      expect(patchBodies).toEqual([{ threadId: `${INBOX_ID}:32665`, isRead: true }]),
    )
    await waitFor(() => expect(screen.queryByLabelText('1 unread')).not.toBeInTheDocument())
  })

  it('does not send a read request for a thread with nothing unread', async () => {
    serve({ threads: [thread({ unreadCount: 0 })] })
    const { user } = render(<PhoneMessagesPage />)

    await user.click(await screen.findByText('Your code is 481516'))

    await screen.findAllByText('Your code is 481516')
    expect(patchBodies).toEqual([])
  })

  it('fetches the next page of threads with the cursor', async () => {
    serve({ hasMore: true, nextCursor: 'CURSOR1' })
    const { user } = render(<PhoneMessagesPage />)

    await user.click(await screen.findByRole('button', { name: /load more/i }))

    expect(await screen.findByText('older thread')).toBeInTheDocument()
    expect(threadRequests.some((q) => q.includes('cursor=CURSOR1'))).toBe(true)
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
  })

  it('renders a short-code sender and an empty media-only message', async () => {
    serve({
      threads: [thread({ body: '', mediaCount: 2 })],
      messages: [message({ body: '', mediaCount: 2 })],
    })
    const { user } = render(<PhoneMessagesPage />)

    await user.click(await screen.findByText('32665'))

    const pane = await screen.findByTestId('thread-messages')
    expect(await within(pane).findByText(/2 attachments not stored/i)).toBeInTheDocument()
  })

  it('opens a long thread on its newest messages and loads older ones above them', async () => {
    serve({
      threads: [thread({ body: 'newest text' })],
      messages: [message({ id: 'n', body: 'newest text', createdAt: '2026-11-02T10:00:00.000Z' })],
      messagesHasMore: true,
      olderMessages: [message({ id: 'o', body: 'much older text', createdAt: '2026-10-01T10:00:00.000Z' })],
    })
    const { user } = render(<PhoneMessagesPage />)

    await user.click(await screen.findByText('newest text'))
    const pane = await screen.findByTestId('thread-messages')
    expect(await within(pane).findByText('newest text')).toBeInTheDocument()
    expect(within(pane).queryByText('much older text')).not.toBeInTheDocument()

    await user.click(within(pane).getByRole('button', { name: /load older/i }))

    const older = await within(pane).findByText('much older text')
    const newest = within(pane).getByText('newest text')
    expect(older.compareDocumentPosition(newest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(threadRequests.some((q) => q.includes('cursor=OLDER1'))).toBe(true)
    expect(within(pane).queryByRole('button', { name: /load older/i })).not.toBeInTheDocument()
  })

  it('does not list a thread twice when it moved to the first page while more were loading', async () => {
    serve({
      hasMore: true,
      nextCursor: 'CURSOR1',
      pageTwoThreads: [thread({ body: 'Your code is 481516' })],
    })
    const { user } = render(<PhoneMessagesPage />)

    await user.click(await screen.findByRole('button', { name: /load more/i }))

    await waitFor(() => expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument())
    expect(screen.getAllByText('Your code is 481516')).toHaveLength(1)
  })

  it('drops a Load more response that arrives after a refresh replaced the list', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    serve({ hasMore: true, nextCursor: 'CURSOR1', pageTwoGate: gate })
    const { user } = render(<PhoneMessagesPage />)
    await user.click(await screen.findByRole('button', { name: /load more/i }))

    serve({ threads: [thread({ id: 'm5', body: 'after refresh' })] })
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('after refresh')).toBeInTheDocument()
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.queryByText('older thread')).not.toBeInTheDocument()
    expect(screen.getByText('after refresh')).toBeInTheDocument()
  })

  it('does not call an empty text an attachment', async () => {
    serve({ threads: [thread({ body: '', mediaCount: 0 })] })

    render(<PhoneMessagesPage />)

    expect(await screen.findByText('(empty message)')).toBeInTheDocument()
    expect(screen.queryByText(/0 attachments/i)).not.toBeInTheDocument()
  })

  it('keeps the loaded threads when Load more fails', async () => {
    serve({ hasMore: true, nextCursor: 'CURSOR1' })
    server.use(
      http.get(`${BASE}/app/phoneInbox/${INBOX_ID}/messages`, ({ request }) => {
        if (new URL(request.url).searchParams.get('cursor')) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 })
        }
        return HttpResponse.json({
          data: { threads: [thread()], nextCursor: 'CURSOR1', hasMore: true },
        })
      }),
    )
    const { user } = render(<PhoneMessagesPage />)

    await user.click(await screen.findByRole('button', { name: /load more/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /load more/i })).toBeEnabled())
    expect(screen.getByText('Your code is 481516')).toBeInTheDocument()
    expect(screen.queryByText(/could not load messages/i)).not.toBeInTheDocument()
  })

  it('picks up newly arrived texts when refreshed', async () => {
    serve()
    const { user } = render(<PhoneMessagesPage />)
    await screen.findByText('Your code is 481516')

    serve({ threads: [thread({ id: 'm5', body: 'Brand new code 999111' })] })
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText('Brand new code 999111')).toBeInTheDocument()
  })

  it('has no compose box: the inbox is receive-only', async () => {
    serve()
    render(<PhoneMessagesPage />)

    await screen.findByText('Your code is 481516')

    expect(screen.queryByPlaceholderText(/type a message/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument()
    expect(screen.getByText(/receive-only/i)).toBeInTheDocument()
  })
})
