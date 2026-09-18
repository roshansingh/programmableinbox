import { deriveBodyText } from '@/lib/email/extract-body-text'
import { extractLinks } from '@/lib/email/extract-links'
import { extractOtp } from '@/lib/email/extract-otp'
import { classifyLinks, type ClassifiedLink } from '@/lib/email/cta-heuristic'

export interface IngestionFields {
  bodyText: string | null
  extractedOtp: string | null
  links: ClassifiedLink[]
}

/**
 * The deterministic part of ingestion, in one place: the searchable body text,
 * the regex-extracted OTP and the classified links. Every path that creates an
 * EmailMessage (the webhook ingest, the send route) and the LLM eval harness
 * (test/llm-eval) call this rather than repeating the sequence, so they cannot
 * drift apart. None of it is gated behind the LLM plan or quota.
 */
export function deriveIngestionFields(input: { text: string; html: string }): IngestionFields {
  const bodyText = deriveBodyText(input)
  return {
    bodyText,
    extractedOtp: extractOtp(bodyText),
    links: classifyLinks(extractLinks(input)),
  }
}
