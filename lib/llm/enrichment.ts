import { prisma } from '@/lib/db'
import { CommercialProvider } from '@/lib/commercial/provider'
import { getProvider } from './factory'

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

    const entitled = await CommercialProvider.entitlements.canUse({
      organizationId: message.organizationId,
      feature: 'llm_enrichment',
    })
    if (!entitled) {
      console.log('[enrichMessage] skip: org not entitled', message.organizationId)
      return true
    }

    if (message.metadata !== null) {
      console.log('[enrichMessage] skip: already enriched', messageId)
      return true
    }

    console.log('[enrichMessage] calling provider.enrich', messageId)
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
    return true
  } catch (error) {
    // console.error intentional: pino transport may be unavailable when this fires
    console.error('[enrichMessage] LLM enrichment failed', { messageId, error })
    return false
  }
}
