import { trace, SpanStatusCode } from '@opentelemetry/api'
import { prisma } from '@/lib/db'
import { CommercialProvider } from '@/lib/commercial/provider'
import { getProvider } from './factory'

const tracer = trace.getTracer('inboxui.llm')

/**
 * Best-effort LLM enrichment. Never throws (so it can't fail ingestion), but
 * returns whether the step is *settled*:
 *  - `true`  — enriched, or a definitive no-op (no provider, not entitled,
 *              already enriched, message gone). Nothing to retry.
 *  - `false` — a transient failure (provider/network error). The caller should
 *              NOT mark the step complete, so it can be re-attempted rather than
 *              permanently skipped (F19).
 */
export async function enrichMessage(messageId: string): Promise<boolean> {
  return tracer.startActiveSpan('llm.enrich_message', async (span) => {
    span.setAttribute('inboxui.message_id', messageId)
    try {
      const settled = await enrichMessageInner(messageId)
      span.setAttribute('inboxui.enrichment.settled', settled)
      if (!settled) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'enrichment failed transiently' })
      }
      return settled
    } catch (error) {
      // Defensive: enrichMessageInner's own catch-all means this should never
      // fire today, but if that contract ever changes silently, the span
      // should record the exception rather than end with an UNSET status.
      // Returns false rather than rethrowing — unlike
      // lib/webhooks/worker.ts's processEmailWebhookJob, enrichMessage's
      // contract (see doc comment above) is to never throw, so an
      // unexpected error is treated the same as a transient failure.
      span.recordException(error as Error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      return false
    } finally {
      span.end()
    }
  })
}

async function enrichMessageInner(messageId: string): Promise<boolean> {
  const provider = getProvider()
  if (!provider) {
    console.log('[enrichMessage] skip: no provider (LLM_PROVIDER not set or unrecognised)')
    return true
  }

  try {
    const message = await prisma.emailMessage.findUnique({
      where: { id: messageId },
      select: { id: true, subject: true, text: true, metadata: true, organizationId: true },
    })
    if (!message) {
      console.log('[enrichMessage] skip: message not found', messageId)
      return true
    }

    // A plan without LLM enrichment is a *settled* skip, not a transient one:
    // retrying would produce the same answer forever, and the caller would
    // never mark the step complete.
    const plan = await CommercialProvider.plans.resolve(message.organizationId)
    if (!plan.limits.llmEnrichment) {
      console.log('[enrichMessage] skip: plan excludes llm enrichment', {
        organizationId: message.organizationId,
        planCode: plan.planCode,
      })
      return true
    }

    if (message.metadata !== null) {
      console.log('[enrichMessage] skip: already enriched', messageId)
      return true
    }

    // Metered after the idempotency check, so a re-run over an already-enriched
    // message costs nothing. Exhausting the meter is a *settled* skip like the
    // feature switch above: retrying would give the same answer until the
    // period rolls over, so the caller must mark the step done rather than
    // re-queue it indefinitely.
    const quota = await CommercialProvider.quota.consume(
      message.organizationId,
      'llm.enrichments',
      1,
      plan,
    )
    if (!quota.allowed) {
      console.log('[enrichMessage] skip: enrichment quota exhausted', {
        organizationId: message.organizationId,
        limit: quota.limit,
        used: quota.used,
      })
      return true
    }

    console.log('[enrichMessage] calling provider.enrich', messageId)
    try {
      const result = await provider.enrich(message.subject, message.text)
      console.log('[enrichMessage] done', { messageId, categories: result.categories, otp: result.extractedOtp })
      await prisma.emailMessage.update({
        where: { id: messageId },
        data: {
          categories: result.categories,
          extractedOtp: result.extractedOtp ?? null,
          metadata: result.metadata,
        },
      })
    } catch (error) {
      // The unit isn't earned until the result is actually persisted: if the
      // provider call succeeds but the update below fails, metadata stays
      // null, so a retry would call the (billable) provider again for the
      // same message unless this refunds the first attempt too.
      await CommercialProvider.quota.refund(message.organizationId, 'llm.enrichments', 1, plan)
      throw error
    }
    return true
  } catch (error) {
    // console.error intentional: pino transport may be unavailable when this fires
    console.error('[enrichMessage] LLM enrichment failed', { messageId, error })
    return false
  }
}
