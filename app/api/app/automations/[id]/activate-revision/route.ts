import { prisma } from '@/lib/db'
import { jsonError, jsonSuccess } from '@/lib/api-helpers'
import { withUser } from '@/lib/auth/with-auth'
import { parseRevisionPayload } from '@/lib/automations/serialization'
import { validateAutomationGraph } from '@/lib/automations/validation'
import { formatAutomationRecord, loadAutomationForUser, readJsonObject } from '../../_utils'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withUser(async (request, principal, { params }: RouteContext) => {

  const parsed = await readJsonObject(request)
  if (parsed.error) return parsed.error

  const revisionId =
    typeof parsed.body.revisionId === 'string' ? parsed.body.revisionId : null
  if (!revisionId) return jsonError('revisionId is required', 400)

  const { id } = await params
  const automation = await loadAutomationForUser(principal, id)
  if (!automation) return jsonError('Not found', 404)

  const revision = await prisma.automationRevision.findFirst({
    where: {
      id: revisionId,
      automationId: automation.id,
    },
  })
  if (!revision) return jsonError('Revision not found', 404)

  if (automation.isActive) {
    try {
      const parsedRevision = parseRevisionPayload(revision)
      const validation = validateAutomationGraph(parsedRevision.config)
      if (!validation.canStart) {
        return jsonError(validation.issues[0]?.message ?? 'Automation is not ready to start', 400)
      }
    } catch {
      return jsonError('Automation revision is not ready to start', 400)
    }
  }

  const updated = await prisma.automation.update({
    where: { id: automation.id },
    data: { activeRevisionId: revision.id },
    include: {
      activeRevision: true,
      revisions: {
        orderBy: { revision: 'desc' },
        take: 10,
      },
    },
  })

  return jsonSuccess(formatAutomationRecord(updated))
})
