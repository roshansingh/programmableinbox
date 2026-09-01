import { trace, SpanStatusCode } from '@opentelemetry/api'
import { prisma } from '@/lib/db'
import { CommercialProvider } from '@/lib/commercial/provider'
import logger from '@/lib/logger'
import { getProvider } from './factory'
import type { EnrichmentMetadata } from './types'

const tracer = trace.getTracer('programmableinbox.llm')

/** How many low-confidence links to send the LLM for CTA review per message. */
const MAX_CTA_CANDIDATES = 10

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
    span.setAttribute('programmableinbox.message_id', messageId)
    try {
      const settled = await enrichMessageInner(messageId)
      span.setAttribute('programmableinbox.enrichment.settled', settled)
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
    logger.info('[enrichMessage] skip: no provider (LLM_PROVIDER not set or unrecognised)')
    return true
  }

  try {
    const message = await prisma.emailMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        subject: true,
        text: true,
        bodyText: true,
        categories: true,
        metadata: true,
        organizationId: true,
      },
    })
    if (!message) {
      logger.info({ messageId }, '[enrichMessage] skip: message not found')
      return true
    }

    // A plan without LLM enrichment is a *settled* skip, not a transient one:
    // retrying would produce the same answer forever, and the caller would
    // never mark the step complete.
    const plan = await CommercialProvider.plans.resolve(message.organizationId)
    if (!plan.limits.llmEnrichment) {
      logger.info(
        { organizationId: message.organizationId, planCode: plan.planCode },
        '[enrichMessage] skip: plan excludes llm enrichment',
      )
      return true
    }

    // categories is written only by this step — deterministic extraction at
    // ingestion (app/api/webhooks/email/route.ts) never touches it — so a
    // non-empty array is an accurate "the LLM already looked at this" signal.
    // `metadata` can no longer be used for this: ingestion now always
    // populates it with deterministically-extracted links, for every plan.
    if (message.categories.length > 0) {
      logger.info({ messageId }, '[enrichMessage] skip: already enriched')
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
      logger.info(
        { organizationId: message.organizationId, limit: quota.limit, used: quota.used },
        '[enrichMessage] skip: enrichment quota exhausted',
      )
      return true
    }

    const storedMetadata: EnrichmentMetadata = {
      links: Array.isArray((message.metadata as { links?: unknown })?.links)
        ? ((message.metadata as unknown as EnrichmentMetadata).links)
        : [],
      timestamps: Array.isArray((message.metadata as { timestamps?: unknown })?.timestamps)
        ? ((message.metadata as unknown as EnrichmentMetadata).timestamps)
        : [],
    }
    // Only links the heuristic couldn't classify confidently go to the LLM —
    // see lib/email/cta-heuristic.ts. Capped so a marketing email with dozens
    // of tracking links doesn't blow up the prompt.
    const candidateLinks = storedMetadata.links
      .filter((link) => link.ctaConfidence === 'low')
      .slice(0, MAX_CTA_CANDIDATES)
      .map((link) => (link.label ? { url: link.url, label: link.label } : { url: link.url }))

    logger.info(
      { messageId, candidateLinkCount: candidateLinks.length },
      '[enrichMessage] calling provider.enrich',
    )
    try {
      // `text` is the raw sender-provided plain-text MIME part and is empty
      // for HTML-only mail; `bodyText` is derived at ingestion (route.ts) and
      // falls back to HTML-extracted text in that case, so it's what actually
      // contains content for those messages.
      const result = await provider.enrich(
        message.subject,
        message.bodyText ?? message.text,
        candidateLinks,
      )
      logger.info({ messageId, categories: result.categories }, '[enrichMessage] done')

      // Patch isCta/ctaConfidence onto the matching stored link by URL —
      // never add, remove, or reorder links here. extractedOtp isn't touched
      // at all: it was written once, at ingestion, and this step never
      // revisits it.
      const mergedLinks = storedMetadata.links.map((link) => {
        const judgment = result.ctaJudgments.find((j) => j.url === link.url)
        return judgment ? { ...link, isCta: judgment.isCta, ctaConfidence: 'high' as const } : link
      })

      await prisma.emailMessage.update({
        where: { id: messageId },
        data: {
          categories: result.categories,
          metadata: { links: mergedLinks, timestamps: result.timestamps },
        },
      })
    } catch (error) {
      // The unit isn't earned until the result is actually persisted: if the
      // provider call succeeds but the update below fails, categories stays
      // empty, so a retry would call the (billable) provider again for the
      // same message unless this refunds the first attempt too.
      await CommercialProvider.quota.refund(message.organizationId, 'llm.enrichments', 1, plan)
      throw error
    }
    return true
  } catch (error) {
    logger.error({ messageId, error }, '[enrichMessage] LLM enrichment failed')
    return false
  }
}
