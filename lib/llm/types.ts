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
 * What the LLM provider returns. It no longer discovers links itself, and
 * OTPs are extracted deterministically first (lib/email/extract-otp.ts). Its
 * job is `categories` (real semantic classification) plus `ctaJudgments`, one
 * per link in the `candidateLinks` it was given (the ones the heuristic in
 * lib/email/cta-heuristic.ts couldn't classify confidently).
 *
 * `otp` and `otpEvidence` are the one exception, and only a fallback: they
 * are requested (see `EnrichOptions`) solely when the regex found nothing,
 * and are null whenever they weren't asked for or the model found no code.
 * `otpEvidence` is the phrase the model says shows the code is a one-time
 * code. Both are an unvalidated proposal — lib/llm/enrichment.ts must pass
 * the pair through `acceptLlmOtp` before storing anything.
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
  otp: string | null
  otpEvidence: string | null
}

const ENRICHMENT_SCHEMA_PROPERTIES = {
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
} as const

// Deliberately not in `required`: they are only asked for when the regex
// extractor missed, so a response without them is the normal case. Plain
// strings rather than ['string', 'null'] — a type array is valid JSON
// Schema but one more thing a provider's tool-schema validator could
// reject, and parseEnrichmentResult already treats absent and null alike.
const OTP_SCHEMA_PROPERTIES = {
  otp: { type: 'string' },
  otpEvidence: { type: 'string' },
} as const

/**
 * The tool/response schema for one enrichment request. The otp fields are
 * included only when the request asks for a code (`extractOtp`): a schema is
 * part of the prompt for tool-calling providers, so listing them on a request
 * that did not ask would invite the model to volunteer a code the caller
 * discards, and spend output tokens doing it. This is what keeps the
 * "fallback only" contract on `EnrichOptions.extractOtp` true for the schema
 * as well as for the system prompt (lib/llm/prompt.ts).
 */
export function buildEnrichmentJsonSchema(options: EnrichOptions = {}) {
  return {
    type: 'object',
    properties: {
      ...ENRICHMENT_SCHEMA_PROPERTIES,
      ...(options.extractOtp === true ? OTP_SCHEMA_PROPERTIES : {}),
    },
    required: ['categories', 'ctaJudgments', 'timestamps'],
  } as const
}

export type EnrichOptions = {
  /**
   * Ask the model for a one-time code too. Set only when the regex extractor
   * found none — otherwise the model is never shown the question, so it
   * cannot second-guess a deterministic hit.
   */
  extractOtp?: boolean
}

export interface LLMProvider {
  enrich(
    subject: string,
    bodyText: string,
    candidateLinks: CandidateLink[],
    options?: EnrichOptions,
  ): Promise<LlmEnrichmentResult>
}

export function parseEnrichmentResult(raw: unknown): LlmEnrichmentResult {
  if (typeof raw !== 'object' || raw === null) {
    return { categories: [], ctaJudgments: [], timestamps: [], otp: null, otpEvidence: null }
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
    otp: typeof obj.otp === 'string' ? obj.otp : null,
    otpEvidence: typeof obj.otpEvidence === 'string' ? obj.otpEvidence : null,
  }
}
