import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LlmEnrichmentResult, CandidateLink } from '../types'
import { UNLIMITED } from '@/lib/commercial/plan-limits'

const mockEnrich = vi.fn<(subject: string, bodyText: string, candidateLinks: CandidateLink[]) => Promise<LlmEnrichmentResult>>()
const mockGetProvider = vi.fn()
const mockResolve = vi.fn()
const mockFindUnique = vi.fn()
const mockUpdate = vi.fn()

/** Builds a resolved plan with `llmEnrichment` set as given. */
function planWithEnrichment(enabled: boolean) {
  return {
    planCode: enabled ? 'self_hosted' : 'free',
    planName: enabled ? 'Self-hosted' : 'Free',
    limits: { ...UNLIMITED, llmEnrichment: enabled },
    periodStart: null,
    periodEnd: null,
  }
}

const mockConsume = vi.fn()

vi.mock('../factory', () => ({ getProvider: mockGetProvider }))
vi.mock('@/lib/commercial/provider', () => ({
  CommercialProvider: {
    plans: { resolve: mockResolve },
    quota: { consume: mockConsume, refund: vi.fn(), peek: vi.fn(), increment: vi.fn() },
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    emailMessage: { findUnique: mockFindUnique, update: mockUpdate },
  },
}))

const startActiveSpanMock = vi.fn((_name: string, fn: (span: unknown) => unknown) => {
  const fakeSpan = { setAttribute: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), end: vi.fn() }
  return fn(fakeSpan)
})

vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/api')>()
  return {
    ...actual,
    trace: { ...actual.trace, getTracer: () => ({ startActiveSpan: startActiveSpanMock }) },
  }
})

const LLM_RESULT: LlmEnrichmentResult = {
  categories: ['Security'],
  ctaJudgments: [],
  timestamps: [],
}

/** A stored EmailMessage row shape as findUnique would return it, post-ingestion. */
function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    subject: 'Your OTP',
    text: 'Code: 654321',
    bodyText: null,
    categories: [],
    metadata: { links: [], timestamps: [] },
    organizationId: 'org-1',
    ...overrides,
  }
}

describe('enrichMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProvider.mockReturnValue({ enrich: mockEnrich })
    mockResolve.mockResolvedValue(planWithEnrichment(true))
    mockConsume.mockResolvedValue({ allowed: true, limit: null, used: 0, resetsAt: null })
    mockFindUnique.mockResolvedValue(baseMessage())
    mockEnrich.mockResolvedValue(LLM_RESULT)
  })

  it('wraps enrichment in an OTel span named llm.enrich_message', async () => {
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(startActiveSpanMock).toHaveBeenCalledWith('llm.enrich_message', expect.any(Function))
  })

  it("never throws, even when an unexpected error occurs outside enrichMessageInner's own catch-all", async () => {
    mockGetProvider.mockImplementation(() => {
      throw new Error('provider factory misconfigured')
    })
    const { enrichMessage } = await import('../enrichment')

    await expect(enrichMessage('msg-1')).resolves.toBe(false)
  })

  it('writes categories and merged link metadata on success, without touching extractedOtp', async () => {
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        categories: ['Security'],
        metadata: { links: [], timestamps: [] },
      },
    })
  })

  it('enriches from bodyText, not the raw text field, when text is empty (HTML-only mail)', async () => {
    mockFindUnique.mockResolvedValue(
      baseMessage({
        subject: 'Your ChatGPT code',
        text: '',
        bodyText: 'Enter this temporary verification code to continue: 851079',
      }),
    )
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockEnrich).toHaveBeenCalledWith(
      'Your ChatGPT code',
      'Enter this temporary verification code to continue: 851079',
      [],
    )
  })

  it('skips when LLM_PROVIDER is not configured (getProvider returns null)', async () => {
    mockGetProvider.mockReturnValue(null)
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('skips when message is not found', async () => {
    mockFindUnique.mockResolvedValue(null)
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('missing-id')

    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockEnrich).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('skips when the plan does not include LLM enrichment', async () => {
    mockResolve.mockResolvedValue(planWithEnrichment(false))
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('consumes one unit of llm.enrichments on success', async () => {
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockConsume).toHaveBeenCalledWith('org-1', 'llm.enrichments', 1, expect.anything())
  })

  it('returns settled without calling the provider when the meter is exhausted', async () => {
    mockConsume.mockResolvedValue({ allowed: false, limit: 100, used: 100, resetsAt: null })
    const { enrichMessage } = await import('../enrichment')

    await expect(enrichMessage('msg-1')).resolves.toBe(true)
    expect(mockEnrich).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('refunds the unit when the provider call fails', async () => {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    mockEnrich.mockRejectedValue(new Error('rate limit'))
    const { enrichMessage } = await import('../enrichment')

    await enrichMessage('msg-1')

    expect(CommercialProvider.quota.refund).toHaveBeenCalledWith('org-1', 'llm.enrichments', 1, expect.anything())
  })

  it('refunds the unit when the DB write after a successful enrich fails', async () => {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    mockUpdate.mockRejectedValue(new Error('connection reset'))
    const { enrichMessage } = await import('../enrichment')

    await expect(enrichMessage('msg-1')).resolves.toBe(false)

    expect(CommercialProvider.quota.refund).toHaveBeenCalledWith('org-1', 'llm.enrichments', 1, expect.anything())
  })

  it('skips when categories is already populated (idempotency)', async () => {
    mockFindUnique.mockResolvedValue(baseMessage({ categories: ['Primary'] }))
    const { enrichMessage } = await import('../enrichment')
    await expect(enrichMessage('msg-1')).resolves.toBe(true)

    expect(mockEnrich).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('does NOT skip when metadata already holds deterministically-extracted links but categories is still empty', async () => {
    mockFindUnique.mockResolvedValue(
      baseMessage({
        metadata: { links: [{ url: 'https://example.com/x', isCta: false, ctaConfidence: 'low' }], timestamps: [] },
      }),
    )
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockEnrich).toHaveBeenCalled()
  })

  it('returns false (transient failure, do not mark done) when provider.enrich rejects', async () => {
    mockEnrich.mockRejectedValue(new Error('rate limit'))
    const { enrichMessage } = await import('../enrichment')
    await expect(enrichMessage('msg-1')).resolves.toBe(false)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('sends only low-confidence links to the provider as CTA candidates, capped at 10', async () => {
    const links = Array.from({ length: 12 }, (_, i) => ({
      url: `https://example.com/${i}`,
      label: `Link ${i}`,
      isCta: false,
      ctaConfidence: 'low' as const,
    }))
    mockFindUnique.mockResolvedValue(baseMessage({ metadata: { links, timestamps: [] } }))
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    const [, , candidateLinks] = mockEnrich.mock.calls[0]
    expect(candidateLinks).toHaveLength(10)
    expect(candidateLinks[0]).toEqual({ url: 'https://example.com/0', label: 'Link 0' })
  })

  it('excludes high-confidence links from the CTA candidates sent to the provider', async () => {
    mockFindUnique.mockResolvedValue(
      baseMessage({
        metadata: {
          links: [
            { url: 'https://example.com/verify', label: 'Verify Email', isCta: true, ctaConfidence: 'high' },
            { url: 'https://example.com/x', label: 'Learn about our story', isCta: false, ctaConfidence: 'low' },
          ],
          timestamps: [],
        },
      }),
    )
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    const [, , candidateLinks] = mockEnrich.mock.calls[0]
    expect(candidateLinks).toEqual([{ url: 'https://example.com/x', label: 'Learn about our story' }])
  })

  it('merges a CTA judgment onto the matching stored link, promoting it to high confidence', async () => {
    mockFindUnique.mockResolvedValue(
      baseMessage({
        metadata: {
          links: [{ url: 'https://example.com/x', label: 'Learn about our story', isCta: false, ctaConfidence: 'low' }],
          timestamps: [],
        },
      }),
    )
    mockEnrich.mockResolvedValue({
      categories: ['Primary'],
      ctaJudgments: [{ url: 'https://example.com/x', isCta: true }],
      timestamps: [],
    })
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        categories: ['Primary'],
        metadata: {
          links: [{ url: 'https://example.com/x', label: 'Learn about our story', isCta: true, ctaConfidence: 'high' }],
          timestamps: [],
        },
      },
    })
  })

  it('leaves a low-confidence link untouched when the provider returns no judgment for it', async () => {
    mockFindUnique.mockResolvedValue(
      baseMessage({
        metadata: {
          links: [{ url: 'https://example.com/x', label: 'Mystery link', isCta: false, ctaConfidence: 'low' }],
          timestamps: [],
        },
      }),
    )
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: {
            links: [{ url: 'https://example.com/x', label: 'Mystery link', isCta: false, ctaConfidence: 'low' }],
            timestamps: [],
          },
        }),
      }),
    )
  })
})
