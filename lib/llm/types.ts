import type { ClassifiedLink } from '@/lib/email/cta-heuristic'

export const EMAIL_CATEGORIES = [
  'Primary', 'Promotions', 'Social', 'Updates', 'Receipts', 'Finance',
  'Travel', 'Support', 'Newsletters', 'Communities', 'Security', 'Scheduling',
  'Applications', 'Notifications', 'Education', 'Agents', 'Urgent', 'Spam',
] as const

export type EmailCategory = typeof EMAIL_CATEGORIES[number]

/**
 * The persisted shape of EmailMessage.metadata. `links` is populated
 * deterministically at ingestion (lib/email/extract-links.ts +
 * lib/email/cta-heuristic.ts) for every organization; lib/llm/enrichment.ts
 * only ever patches `isCta`/`ctaConfidence` on existing entries by URL match,
 * never adds or removes links.
 */
export type EnrichmentMetadata = {
  links: ClassifiedLink[]
  timestamps: string[]
}

export type CandidateLink = { url: string; label?: string }

/**
 * What the LLM provider returns. It no longer discovers links or OTPs itself
 * — those are extracted deterministically before the LLM ever runs. Its job
 * is `categories` (real semantic classification) plus `ctaJudgments`, one
 * per link in the `candidateLinks` it was given (the ones the heuristic in
 * lib/email/cta-heuristic.ts couldn't classify confidently).
 *
 * `ctaJudgments` references a candidate by its position (`i`) in the
 * `candidateLinks` array the provider was given, not by echoing the URL
 * back. Tracking links routinely run 200-400+ chars; asking the model to
 * repeat up to MAX_CTA_CANDIDATES of them verbatim can blow the output
 * token budget on nothing but URL characters and truncate the response
 * (see providers/openai-compat.ts and providers/anthropic.ts for how a
 * truncated response is surfaced rather than silently swallowed).
 */
export type LlmEnrichmentResult = {
  categories: EmailCategory[]
  ctaJudgments: Array<{ i: number; isCta: boolean }>
  timestamps: string[]
}

export const ENRICHMENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    categories: {
      type: 'array',
      items: { type: 'string', enum: [...EMAIL_CATEGORIES] },
    },
    ctaJudgments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          isCta: { type: 'boolean' },
        },
        required: ['i', 'isCta'],
      },
    },
    timestamps: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['categories', 'ctaJudgments', 'timestamps'],
} as const

export interface LLMProvider {
  enrich(subject: string, bodyText: string, candidateLinks: CandidateLink[]): Promise<LlmEnrichmentResult>
}

export function parseEnrichmentResult(raw: unknown): LlmEnrichmentResult {
  if (typeof raw !== 'object' || raw === null) {
    return { categories: [], ctaJudgments: [], timestamps: [] }
  }
  const obj = raw as Record<string, unknown>
  return {
    categories: Array.isArray(obj.categories)
      ? (obj.categories as string[]).filter(
          (c): c is EmailCategory => (EMAIL_CATEGORIES as readonly string[]).includes(c)
        )
      : [],
    ctaJudgments: Array.isArray(obj.ctaJudgments)
      ? (obj.ctaJudgments as Array<{ i: unknown; isCta: unknown }>)
          .filter((j) => typeof j?.i === 'number' && Number.isInteger(j.i) && typeof j?.isCta === 'boolean')
          .map((j) => ({ i: j.i as number, isCta: j.isCta as boolean }))
      : [],
    timestamps: Array.isArray(obj.timestamps) ? (obj.timestamps as string[]) : [],
  }
}
