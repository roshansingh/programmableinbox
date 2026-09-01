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
 */
export type LlmEnrichmentResult = {
  categories: EmailCategory[]
  ctaJudgments: Array<{ url: string; isCta: boolean }>
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
          url: { type: 'string' },
          isCta: { type: 'boolean' },
        },
        required: ['url', 'isCta'],
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
      ? (obj.ctaJudgments as Array<{ url: unknown; isCta: unknown }>)
          .filter((j) => typeof j?.url === 'string' && typeof j?.isCta === 'boolean')
          .map((j) => ({ url: j.url as string, isCta: j.isCta as boolean }))
      : [],
    timestamps: Array.isArray(obj.timestamps) ? (obj.timestamps as string[]) : [],
  }
}
