import { describe, it, expect, beforeEach, onTestFinished, vi } from 'vitest'
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
  /** Holds the first page of the list back until released. */
  firstPageGate?: Promise<void>
  /** Holds the next-older page of a thread back until released. */
  olderGate?: Promise<void>
} = {}) {
  server.use(
    http.get(`${BASE}/app/phoneInbox/${INBOX_ID}`, () => HttpResponse.json({ data: inbox })),
    http.get(`${BASE}/app/phoneInbox/${INBOX_ID}/messages`, async ({ request }) => {
      const url = new URL(request.url)
      threadRequests.push(url.search)
      if (url.searchParams.get('threadId')) {
        if (url.searchParams.get('cursor')) {
          await opts.olderGate
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
      await opts.firstPageGate
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

  it('shows a thread that moved to the top while the next page was loading', async () => {
    // The server cannot return a thread on page 2 that is already on page 1; it
    // can move one from page 2 onto page 1 after the user has scrolled past, and
    // then page 2 simply no longer contains it.
    let firstPageCalls = 0
    server.use(
      http.get(`${BASE}/app/phoneInbox/${INBOX_ID}`, () => HttpResponse.json({ data: inbox })),
      http.get(`${BASE}/app/phoneInbox/${INBOX_ID}/messages`, ({ request }) => {
        if (new URL(request.url).searchParams.get('cursor')) {
          return HttpResponse.json({ data: { threads: [], nextCursor: null, hasMore: false } })
        }
        firstPageCalls += 1
        const moved = thread({ id: 'm7', from: '55555', threadId: `${INBOX_ID}:55555`, body: 'code that just arrived' })
        return HttpResponse.json({
          data: {
            threads: firstPageCalls === 1 ? [thread()] : [moved, thread()],
            nextCursor: 'CURSOR1',
            hasMore: true,
          },
        })
      }),
    )
    const { user } = render(<PhoneMessagesPage />)

    await user.click(await screen.findByRole('button', { name: /load more/i }))

    expect(await screen.findByText('code that just arrived')).toBeInTheDocument()
    expect(screen.getAllByText('Your code is 481516')).toHaveLength(1)
  })

  it('scrolls a thread to its newest message when opened, but not when older ones load', async () => {
    const scroll = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    onTestFinished(() => {
      Element.prototype.scrollIntoView = original
    })
    serve({
      threads: [thread({ body: 'newest text' })],
      messages: [message({ id: 'n', body: 'newest text' })],
      messagesHasMore: true,
      olderMessages: [message({ id: 'o', body: 'older text', createdAt: '2026-10-01T10:00:00.000Z' })],
    })
    const { user } = render(<PhoneMessagesPage />)

    await user.click(await screen.findByText('newest text'))
    await screen.findByTestId('thread-messages')
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    const afterOpen = scroll.mock.calls.length

    await user.click(await screen.findByRole('button', { name: /load older/i }))
    await screen.findByText('older text')

    expect(scroll.mock.calls.length).toBe(afterOpen)
  })

  it('can refresh the open conversation from the conversation pane', async () => {
    serve({ messages: [message({ body: 'first version' })] })
    const { user } = render(<PhoneMessagesPage />)
    await user.click(await screen.findByText('Your code is 481516'))
    await screen.findByText('first version')

    serve({ messages: [message({ id: 'z', body: 'newer code 222333' }), message({ body: 'first version' })] })
    await user.click(screen.getByRole('button', { name: 'Refresh conversation' }))

    expect(await screen.findByText('newer code 222333')).toBeInTheDocument()
  })

  it('shows a one-time code with a copy button once enrichment has extracted it', async () => {
    serve({ messages: [message({ body: 'Your code is 481516', extractedOtp: '481516' })] })
    const { user } = render(<PhoneMessagesPage />)
    await user.click(await screen.findByText('Your code is 481516'))

    await user.click(await screen.findByRole('button', { name: /copy code 481516/i }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('481516')
  })

  it('offers no copy button for a message without an extracted code', async () => {
    serve()
    const { user } = render(<PhoneMessagesPage />)
    await user.click(await screen.findByText('Your code is 481516'))
    await screen.findByTestId('thread-messages')

    expect(screen.queryByRole('button', { name: /copy code/i })).not.toBeInTheDocument()
  })

  it('warns that a number still being set up is not receiving texts', async () => {
    server.use(
      http.get(`${BASE}/app/phoneInbox/${INBOX_ID}`, () =>
        HttpResponse.json({ data: { ...inbox, status: 'pending' } }),
      ),
      http.get(`${BASE}/app/phoneInbox/${INBOX_ID}/messages`, () =>
        HttpResponse.json({ data: { threads: [], nextCursor: null, hasMore: false } }),
      ),
    )

    render(<PhoneMessagesPage />)

    expect(await screen.findByText(/still being set up/i)).toBeInTheDocument()
    expect(screen.queryByText(/texts sent to this number will appear here/i)).not.toBeInTheDocument()
  })

  it('marks the selected conversation for assistive technology', async () => {
    serve()
    const { user } = render(<PhoneMessagesPage />)
    const row = (await screen.findByText('Your code is 481516')).closest('button')!
    expect(row).not.toHaveAttribute('aria-current')

    await user.click(row)

    expect(row).toHaveAttribute('aria-current', 'true')
  })

  it('cannot start Load more while a refresh is replacing the list', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    serve({ hasMore: true, nextCursor: 'CURSOR1' })
    const { user } = render(<PhoneMessagesPage />)
    const loadMore = await screen.findByRole('button', { name: /load more/i })

    serve({ hasMore: true, nextCursor: 'CURSOR2', firstPageGate: gate })
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    // Its cursor belongs to the list being replaced, so a page fetched with it
    // would be appended to the new list and could skip a thread at the boundary.
    expect(loadMore).toBeDisabled()
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: /load more/i })).toBeEnabled())
  })

  it('drops an older page of a thread that arrives after the thread was refreshed', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    serve({
      threads: [thread({ body: 'newest text' })],
      messages: [message({ id: 'n', body: 'newest text' })],
      messagesHasMore: true,
      olderMessages: [message({ id: 'o', body: 'stale older text', createdAt: '2026-10-01T10:00:00.000Z' })],
      olderGate: gate,
    })
    const { user } = render(<PhoneMessagesPage />)
    await user.click(await screen.findByText('newest text'))
    await user.click(await screen.findByRole('button', { name: /load older/i }))

    serve({
      threads: [thread({ body: 'newest text' })],
      messages: [message({ id: 'z', body: 'arrived meanwhile' }), message({ id: 'n', body: 'newest text' })],
    })
    await user.click(screen.getByRole('button', { name: 'Refresh conversation' }))
    await screen.findByText('arrived meanwhile')
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))

    // The cursor it used belonged to the replaced page: appending would leave a gap.
    expect(screen.queryByText('stale older text')).not.toBeInTheDocument()
  })

  it('leaves a thread unread when its messages could not be loaded', async () => {
    server.use(
      http.get(`${BASE}/app/phoneInbox/${INBOX_ID}`, () => HttpResponse.json({ data: inbox })),
      http.get(`${BASE}/app/phoneInbox/${INBOX_ID}/messages`, ({ request }) => {
        if (new URL(request.url).searchParams.get('threadId')) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 })
        }
        return HttpResponse.json({ data: { threads: [thread()], nextCursor: null, hasMore: false } })
      }),
      http.patch(`${BASE}/app/phoneInbox/${INBOX_ID}/messages`, async ({ request }) => {
        patchBodies.push(await request.json())
        return HttpResponse.json({ data: { updated: 1 } })
      }),
    )
    const { user } = render(<PhoneMessagesPage />)

    await user.click(await screen.findByText('Your code is 481516'))

    expect(await screen.findByText(/could not load this conversation/i)).toBeInTheDocument()
    // Viewing it failed, so it was not read.
    expect(screen.getByLabelText('1 unread')).toBeInTheDocument()
    expect(patchBodies).toEqual([])
  })

  it('marks a text that arrives in the open conversation read when it is refreshed', async () => {
    serve()
    const { user } = render(<PhoneMessagesPage />)
    await user.click(await screen.findByText('Your code is 481516'))
    await waitFor(() => expect(patchBodies).toHaveLength(1))

    serve({
      threads: [thread({ unreadCount: 1, threadCount: 2 })],
      messages: [message({ id: 'z', body: 'second code 999000' }), message()],
    })
    await user.click(screen.getByRole('button', { name: 'Refresh conversation' }))

    expect(await screen.findByText('second code 999000')).toBeInTheDocument()
    await waitFor(() => expect(patchBodies).toHaveLength(2))
    await waitFor(() => expect(screen.queryByLabelText('1 unread')).not.toBeInTheDocument())
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
