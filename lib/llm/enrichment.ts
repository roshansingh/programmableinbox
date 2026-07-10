import { prisma } from '@/lib/db'
import { CommercialProvider } from '@/lib/commercial/provider'
import { getProvider } from './factory'

export async function enrichMessage(messageId: string): Promise<void> {
  const provider = getProvider()
  if (!provider) {
    console.log('[enrichMessage] skip: no provider (LLM_PROVIDER not set or unrecognised)')
    return
  }

  try {
    const message = await prisma.emailMessage.findUnique({
      where: { id: messageId },
      select: { id: true, subject: true, text: true, metadata: true, organizationId: true },
    })
    if (!message) {
      console.log('[enrichMessage] skip: message not found', messageId)
      return
    }

    const entitled = await CommercialProvider.entitlements.canUse({
      organizationId: message.organizationId,
      feature: 'llm_enrichment',
    })
    if (!entitled) {
      console.log('[enrichMessage] skip: org not entitled', message.organizationId)
      return
    }

    if (message.metadata !== null) {
      console.log('[enrichMessage] skip: already enriched', messageId)
      return
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
  } catch (error) {
    // console.error intentional: pino transport may be unavailable when this fires
    console.error('[enrichMessage] LLM enrichment failed', { messageId, error })
  }
}
