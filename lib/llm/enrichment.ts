import { prisma } from '@/lib/db'
import { CommercialProvider } from '@/lib/commercial/provider'
import { getProvider } from './factory'
import logger from '@/lib/logger'

export async function enrichMessage(messageId: string): Promise<void> {
  const provider = getProvider()
  if (!provider) return

  try {
    const message = await prisma.emailMessage.findUnique({
      where: { id: messageId },
      select: { id: true, subject: true, text: true, metadata: true, organizationId: true },
    })
    if (!message) return

    const entitled = await CommercialProvider.entitlements.canUse({
      organizationId: message.organizationId,
      feature: 'llm_enrichment',
    })
    if (!entitled) return

    if (message.metadata !== null) return

    const result = await provider.enrich(message.subject, message.text)
    await prisma.emailMessage.update({
      where: { id: messageId },
      data: {
        categories: result.categories,
        extractedOtp: result.extractedOtp ?? null,
        metadata: result.metadata,
      },
    })
  } catch (error) {
    logger.error({ error, messageId }, 'LLM enrichment failed')
  }
}
