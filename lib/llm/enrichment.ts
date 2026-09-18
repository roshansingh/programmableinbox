import { trace, SpanStatusCode } from '@opentelemetry/api'
import { prisma } from '@/lib/db'
import { CommercialProvider } from '@/lib/commercial/provider'
import logger from '@/lib/logger'
import { getProvider } from './factory'
import type { EnrichmentMetadata, CandidateLink } from './types'
import type { ClassifiedLink } from '@/lib/email/cta-heuristic'
import { acceptLlmOtp } from '@/lib/email/extract-otp'

const tracer = trace.getTracer('programmableinbox.llm')

/** How many low-confidence links to send the LLM for CTA review per message. */
const MAX_CTA_CANDIDATES = 10
/** Caps on what a single candidate link contributes to the prompt (see sanitizeCandidateForPrompt). */
const MAX_CANDIDATE_URL_LENGTH = 200
const MAX_CANDIDATE_LABEL_LENGTH = 100

/**
 * Strips query string, fragment, and any userinfo before a candidate link's
 * URL leaves the process for the LLM prompt, and caps both URL and label
 * length. CTA classification only needs the origin/path/label; the query
 * string is exactly where a tracking or one-time-token value would live
 * (bodyText already omits hrefs entirely, for the same reason — see
 * lib/email/extract-body-text.ts), so sending it verbatim to a third-party
 * provider would newly disclose it. The length caps guard against a single
 * pathological label/URL (unbounded anchor text, a huge tracking path)
 * blowing up the prompt across up to MAX_CTA_CANDIDATES links. The
 * *original*, untruncated link (from `candidateLinks`, not this function's
 * output) is what the index-based merge in enrichMessageInner matches
 * against — never this sanitized copy.
 */
function sanitizeCandidateForPrompt(link: ClassifiedLink): CandidateLink {
  let url = link.url
  try {
    const parsed = new URL(link.url)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    url = parsed.toString()
  } catch {
    // extractLinks (lib/email/extract-links.ts) only ever stores a URL that
    // already parsed successfully, so this is unreachable in practice — but
    // never forward an unparseable value to the prompt unsanitized.
  }
  url = url.slice(0, MAX_CANDIDATE_URL_LENGTH)
  const label = link.label?.slice(0, MAX_CANDIDATE_LABEL_LENGTH)
  return label ? { url, label } : { url }
}

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
        extractedOtp: true,
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

    // categories is written only by this step — deterministic extraction,
    // wherever a message row is created (app/api/webhooks/email/route.ts for
    // inbound, app/api/app/emailInbox/[id]/send/route.ts for outbound), never
    // touches it — so a non-empty array is an accurate "the LLM already
    // looked at this" signal. `metadata` can no longer be used for this:
    // every EmailMessage creation path now populates it with
    // deterministically-extracted links, for every plan.
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
    // of tracking links doesn't blow up the prompt. Kept as the ClassifiedLink
    // subset (not yet narrowed to {url, label}) so its array position doubles
    // as the index the provider references in ctaJudgments — see lib/llm/types.ts.
    const candidateLinks = storedMetadata.links
      .filter((link) => link.ctaConfidence === 'low')
      .slice(0, MAX_CTA_CANDIDATES)
    const candidateLinksForPrompt = candidateLinks.map(sanitizeCandidateForPrompt)

    logger.info(
      { messageId, candidateLinkCount: candidateLinks.length },
      '[enrichMessage] calling provider.enrich',
    )
    try {
      // `text` is the raw sender-provided plain-text MIME part and is empty
      // for HTML-only mail; `bodyText` is derived at ingestion (route.ts) and
      // falls back to HTML-extracted text in that case, so it's what actually
      // contains content for those messages.
      const promptText = message.bodyText ?? message.text
      // Only ask for an OTP when the ingestion-time regex found none.
      // extractedOtp is written once, at insert, by nothing but that regex
      // (see the write in app/api/webhooks/email/route.ts), so null here
      // means "the regex missed", and a non-null value is never revisited.
      const wantOtp = message.extractedOtp === null
      const result = await provider.enrich(message.subject, promptText, candidateLinksForPrompt, {
        extractOtp: wantOtp,
      })

      // The system prompt requires "Always include at least one" category
      // (lib/llm/prompt.ts), so an empty array here is never a legitimate
      // answer — it's the adapters' shared fallback for a refusal, a missing
      // tool_use block, or a non-length parse failure (see providers/*.ts).
      // Persisting it would be indistinguishable from a genuine "checked and
      // found nothing", permanently marking this message settled — with the
      // categories.length > 0 check above then unable to tell a real prior
      // attempt apart from one that never ran, so a retry (e.g. after this
      // update succeeds but the caller's enrichedAt write fails) would bill
      // the provider again. Throw instead, so this goes through the same
      // refund-and-retry path as a transient provider error.
      if (result.categories.length === 0) {
        throw new Error('[enrichMessage] provider returned no categories')
      }

      // The model's answer is a proposal, not a fact, and a mislabelled
      // discount code is the failure that matters here, so two independent
      // checks must both pass:
      //  - the model's own classification must agree: an email it did not
      //    tag Security is not one it believes carries a login code, however
      //    plausible the token looks. This deliberately costs some recall (a
      //    real code on an email tagged Primary/Notifications is dropped) for
      //    fewer false positives;
      //  - acceptLlmOtp must confirm the quoted evidence and the code against
      //    the text the model was shown, with deterministic rules.
      // A null/rejected answer is a normal "no code here", not a failure —
      // unlike an empty categories list it must not refund and retry, since
      // every retry would give the same answer.
      const otpProposed = wantOtp && result.otp !== null
      const recoveredOtp =
        otpProposed && result.categories.includes('Security')
          ? acceptLlmOtp({ otp: result.otp, evidence: result.otpEvidence }, promptText)
          : null
      // Never log the code or its evidence: the code is a live credential.
      logger.info(
        {
          messageId,
          categories: result.categories,
          otpProposed,
          otpRecovered: recoveredOtp !== null,
        },
        '[enrichMessage] done',
      )

      // Patch isCta/ctaConfidence onto the matching stored link by candidate
      // index — never add, remove, or reorder links here. extractedOtp is
      // written only as the fallback above, and only when the ingestion-time
      // regex left it null; a code the regex found is never overwritten.
      const mergedLinks = storedMetadata.links.map((link) => {
        const candidateIndex = candidateLinks.findIndex((c) => c.url === link.url)
        if (candidateIndex === -1) return link
        const judgment = result.ctaJudgments.find((j) => j.i === candidateIndex)
        return judgment ? { ...link, isCta: judgment.isCta, ctaConfidence: 'high' as const } : link
      })

      await prisma.emailMessage.update({
        where: { id: messageId },
        data: {
          categories: result.categories,
          metadata: { links: mergedLinks, timestamps: result.timestamps },
          // Same update as categories on purpose: the refund-on-failure and
          // idempotency reasoning around this write covers the OTP for free.
          ...(recoveredOtp !== null ? { extractedOtp: recoveredOtp } : {}),
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
