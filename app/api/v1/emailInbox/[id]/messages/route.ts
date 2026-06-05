import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveAuthContext } from '@/lib/auth/auth-context'
import { requireScope, requireOrgAccess } from '@/lib/auth/authorization'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const context = await resolveAuthContext(request)
  if (!context) return jsonError('Unauthorized', 401)

  const { id } = await params

  const inbox = await prisma.emailInbox.findUnique({ where: { id } })
  if (!inbox) {
    return jsonError('Not found', 404)
  }

  if (context.kind === 'user') {
    if (inbox.userId !== context.userId) {
      return jsonError('Not found', 404)
    }
  } else {
    const scopeResult = requireScope(context, 'messages:read')
    if ('error' in scopeResult) {
      return scopeResult.error
    }

    const orgResult = requireOrgAccess(context, inbox.organizationId)
    if ('error' in orgResult) {
      return orgResult.error
    }
  }

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = parseInt(searchParams.get('limit') || '50', 10)
  const threadId = searchParams.get('threadId')
  const grouped = searchParams.get('grouped') === 'true'

  const where: Record<string, unknown> = { inboxEmailAddressId: id }
  if (threadId) {
    where.threadId = threadId
  }

  // When grouped, return only the latest message per thread
  if (grouped && !threadId) {
    // Get all messages for this inbox, ordered by createdAt desc
    const allMessages = await prisma.emailMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    // Group by threadId, keeping only the latest message per thread
    const threadMap = new Map<string, typeof allMessages[0] & { threadCount: number }>()
    const threadCounts = new Map<string, number>()

    for (const msg of allMessages) {
      threadCounts.set(msg.threadId, (threadCounts.get(msg.threadId) || 0) + 1)
      if (!threadMap.has(msg.threadId)) {
        threadMap.set(msg.threadId, { ...msg, threadCount: 1 })
      }
    }

    // Set correct thread counts
    for (const [tid, entry] of threadMap) {
      entry.threadCount = threadCounts.get(tid) || 1
    }

    const threads = Array.from(threadMap.values())
    const total = threads.length
    const paginated = threads.slice((page - 1) * limit, page * limit)

    return jsonSuccess({ messages: paginated, total, page, limit })
  }

  const [messages, total] = await Promise.all([
    prisma.emailMessage.findMany({
      where,
      orderBy: { createdAt: threadId ? 'asc' : 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.emailMessage.count({ where }),
  ])

  return jsonSuccess({ messages, total, page, limit })
}
