export const EMAIL_CATEGORIES = [
  'Primary', 'Promotions', 'Social', 'Updates', 'Receipts', 'Finance',
  'Travel', 'Support', 'Newsletters', 'Communities', 'Security', 'Scheduling',
  'Applications', 'Notifications', 'Education', 'Agents', 'Urgent', 'Spam',
] as const

export type EmailCategory = typeof EMAIL_CATEGORIES[number]

export type EnrichmentMetadata = {
  links: Array<{ url: string; label?: string; isCta: boolean }>
  timestamps: string[]
}

export type EnrichmentResult = {
  categories: EmailCategory[]
  extractedOtp: string | null
  metadata: EnrichmentMetadata
}

export const ENRICHMENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    categories: {
      type: 'array',
      items: { type: 'string', enum: [...EMAIL_CATEGORIES] },
    },
    extractedOtp: { type: ['string', 'null'] },
    metadata: {
      type: 'object',
      properties: {
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              label: { type: 'string' },
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
      required: ['links', 'timestamps'],
    },
  },
  required: ['categories', 'extractedOtp', 'metadata'],
} as const

export interface LLMProvider {
  enrich(subject: string, bodyText: string): Promise<EnrichmentResult>
}

export function parseEnrichmentResult(raw: unknown): EnrichmentResult {
  if (typeof raw !== 'object' || raw === null) {
    return { categories: [], extractedOtp: null, metadata: { links: [], timestamps: [] } }
  }
  const obj = raw as Record<string, unknown>
  const meta = (obj.metadata as Record<string, unknown>) ?? {}
  return {
    categories: Array.isArray(obj.categories)
      ? (obj.categories as string[]).filter(
          (c): c is EmailCategory => (EMAIL_CATEGORIES as readonly string[]).includes(c)
        )
      : [],
    extractedOtp: typeof obj.extractedOtp === 'string' ? obj.extractedOtp : null,
    metadata: {
      links: Array.isArray(meta.links)
        ? (meta.links as EnrichmentMetadata['links']).filter((link) => {
            if (typeof link?.url !== 'string') return false
            try {
              const parsed = new URL(link.url)
              return parsed.protocol === 'https:' || parsed.protocol === 'http:'
            } catch {
              return false
            }
          })
        : [],
      timestamps: Array.isArray(meta.timestamps) ? (meta.timestamps as string[]) : [],
    },
  }
}
