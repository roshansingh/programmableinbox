import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LlmEnrichmentResult, CandidateLink, EnrichOptions } from '../types'
import { UNLIMITED } from '@/lib/commercial/plan-limits'

const mockEnrich = vi.fn<
  (
    subject: string,
    bodyText: string,
    candidateLinks: CandidateLink[],
    options?: EnrichOptions,
  ) => Promise<LlmEnrichmentResult>
>()
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
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
vi.mock('@/lib/logger', () => ({ default: mockLogger }))
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
  otp: null,
  otpEvidence: null,
}

/** A stored EmailMessage row shape as findUnique would return it, post-ingestion. */
function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    subject: 'Your OTP',
    text: 'Code: 654321',
    bodyText: null,
    // null = the regex extractor found nothing at ingestion, which is the
    // only case the LLM is asked for an OTP.
    extractedOtp: null,
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
    // vi.clearAllMocks() clears call history but not a mock's configured
    // implementation, so a test that does `mockUpdate.mockRejectedValue(...)`
    // (not `...Once`) leaves every later test's update calls rejecting too
    // unless something resets it back — this is that reset.
    mockUpdate.mockResolvedValue(undefined)
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

  it('writes categories and merged link metadata on success, leaving extractedOtp alone when the model finds no code', async () => {
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
      { extractOtp: true },
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

  it('strips query string, fragment, and credentials from a candidate URL before sending it to the provider', async () => {
    mockFindUnique.mockResolvedValue(
      baseMessage({
        metadata: {
          links: [
            {
              url: 'https://user:pass@example.com/verify?token=super-secret-one-time-token&utm_source=campaign#section',
              label: 'Verify',
              isCta: false,
              ctaConfidence: 'low',
            },
          ],
          timestamps: [],
        },
      }),
    )
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    const [, , candidateLinks] = mockEnrich.mock.calls[0]
    expect(candidateLinks).toEqual([{ url: 'https://example.com/verify', label: 'Verify' }])
  })

  it('caps an excessively long candidate URL or label before sending it to the provider', async () => {
    const hugeUrl = `https://example.com/${'a'.repeat(500)}`
    const hugeLabel = 'x'.repeat(500)
    mockFindUnique.mockResolvedValue(
      baseMessage({
        metadata: {
          links: [{ url: hugeUrl, label: hugeLabel, isCta: false, ctaConfidence: 'low' }],
          timestamps: [],
        },
      }),
    )
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    const [, , candidateLinks] = mockEnrich.mock.calls[0]
    expect(candidateLinks[0].url.length).toBeLessThanOrEqual(200)
    expect(candidateLinks[0].label?.length).toBeLessThanOrEqual(100)
  })

  it('still merges the CTA judgment onto the original (unsanitized, untruncated) stored link', async () => {
    const realUrl = 'https://example.com/verify?token=abc123'
    mockFindUnique.mockResolvedValue(
      baseMessage({
        metadata: {
          links: [{ url: realUrl, label: 'Verify', isCta: false, ctaConfidence: 'low' }],
          timestamps: [],
        },
      }),
    )
    mockEnrich.mockResolvedValue({
      categories: ['Security'],
      ctaJudgments: [{ i: 0, isCta: true }],
      timestamps: [],
      otp: null,
      otpEvidence: null,
    })
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        categories: ['Security'],
        metadata: {
          links: [{ url: realUrl, label: 'Verify', isCta: true, ctaConfidence: 'high' }],
          timestamps: [],
        },
      },
    })
  })

  it('treats an empty categories result as a failure, refunding quota and not persisting', async () => {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    mockEnrich.mockResolvedValue({ categories: [], ctaJudgments: [], timestamps: [], otp: null, otpEvidence: null })
    const { enrichMessage } = await import('../enrichment')

    await expect(enrichMessage('msg-1')).resolves.toBe(false)

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(CommercialProvider.quota.refund).toHaveBeenCalledWith('org-1', 'llm.enrichments', 1, expect.anything())
  })

  it('a retry after an empty-categories result re-attempts (does not skip as already-enriched)', async () => {
    // Nothing was persisted for the first attempt, so categories stays [] —
    // confirms the retry path actually re-invokes the provider rather than
    // silently treating the empty first attempt as done.
    mockEnrich.mockResolvedValueOnce({ categories: [], ctaJudgments: [], timestamps: [], otp: null, otpEvidence: null })
    const { enrichMessage } = await import('../enrichment')
    await expect(enrichMessage('msg-1')).resolves.toBe(false)
    expect(mockEnrich).toHaveBeenCalledTimes(1)

    mockEnrich.mockResolvedValueOnce({
      categories: ['Security'],
      ctaJudgments: [],
      timestamps: [],
      otp: null,
      otpEvidence: null,
    })
    await expect(enrichMessage('msg-1')).resolves.toBe(true)
    expect(mockEnrich).toHaveBeenCalledTimes(2)
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
      ctaJudgments: [{ i: 0, isCta: true }],
      timestamps: [],
      otp: null,
      otpEvidence: null,
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

  it('merges CTA judgments by candidate position, not by array order in storedMetadata.links', async () => {
    // A high-confidence link sits before the low-confidence ones in storage,
    // so the candidate list sent to the provider (only the low-confidence
    // ones) has a different index order than storedMetadata.links — proves
    // the merge keys off candidateLinks' own position, not a shared index.
    mockFindUnique.mockResolvedValue(
      baseMessage({
        metadata: {
          links: [
            { url: 'https://example.com/verify', label: 'Verify', isCta: true, ctaConfidence: 'high' },
            { url: 'https://example.com/a', label: 'A', isCta: false, ctaConfidence: 'low' },
            { url: 'https://example.com/b', label: 'B', isCta: false, ctaConfidence: 'low' },
          ],
          timestamps: [],
        },
      }),
    )
    // candidateLinks (low-confidence only) is [a, b] — index 0 is "a", index 1 is "b".
    mockEnrich.mockResolvedValue({
      categories: ['Primary'],
      ctaJudgments: [{ i: 1, isCta: true }],
      timestamps: [],
      otp: null,
      otpEvidence: null,
    })
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        categories: ['Primary'],
        metadata: {
          links: [
            { url: 'https://example.com/verify', label: 'Verify', isCta: true, ctaConfidence: 'high' },
            { url: 'https://example.com/a', label: 'A', isCta: false, ctaConfidence: 'low' },
            { url: 'https://example.com/b', label: 'B', isCta: true, ctaConfidence: 'high' },
          ],
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

  describe('OTP fallback (regex found nothing at ingestion)', () => {
    const SENTENCE = 'Use this sign-in token to continue: 851079'

    /** A model answer: a code, the sentence it says justifies it, and the categories it chose. */
    const otpResult = (
      otp: string | null,
      otpEvidence: string | null = null,
      categories: LlmEnrichmentResult['categories'] = ['Security'],
    ): LlmEnrichmentResult => ({ ...LLM_RESULT, categories, otp, otpEvidence })

    it('reads extractedOtp, so it can tell whether the regex already hit', async () => {
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ select: expect.objectContaining({ extractedOtp: true }) }),
      )
    })

    it('asks the provider for an OTP when the regex found none', async () => {
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockEnrich).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), {
        extractOtp: true,
      })
    })

    it('does not ask the provider for an OTP when the regex already found one', async () => {
      mockFindUnique.mockResolvedValue(baseMessage({ extractedOtp: '654321' }))
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockEnrich).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), {
        extractOtp: false,
      })
    })

    it('stores a code the model found, in the same update as categories', async () => {
      mockFindUnique.mockResolvedValue(baseMessage({ text: '', bodyText: SENTENCE }))
      mockEnrich.mockResolvedValue(otpResult('851079', SENTENCE))
      const { enrichMessage } = await import('../enrichment')

      await expect(enrichMessage('msg-1')).resolves.toBe(true)

      expect(mockUpdate).toHaveBeenCalledTimes(1)
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        data: {
          categories: ['Security'],
          metadata: { links: [], timestamps: [] },
          extractedOtp: '851079',
        },
      })
    })

    it('stores the contiguous form of a code the email prints split', async () => {
      const body = 'Your sign-in token: 851 079'
      mockFindUnique.mockResolvedValue(baseMessage({ text: '', bodyText: body }))
      mockEnrich.mockResolvedValue(otpResult('851 079', body))
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockUpdate.mock.calls[0][0].data.extractedOtp).toBe('851079')
    })

    it('checks the code against the same text the model was shown (text when bodyText is null)', async () => {
      mockFindUnique.mockResolvedValue(baseMessage({ bodyText: null, text: SENTENCE }))
      mockEnrich.mockResolvedValue(otpResult('851079', SENTENCE))
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockUpdate.mock.calls[0][0].data.extractedOtp).toBe('851079')
    })

    it('drops a code that is not in the body, but still saves the classification', async () => {
      mockFindUnique.mockResolvedValue(baseMessage({ text: '', bodyText: SENTENCE }))
      mockEnrich.mockResolvedValue(otpResult('999999', 'Use this sign-in token to continue: 999999'))
      const { enrichMessage } = await import('../enrichment')

      await expect(enrichMessage('msg-1')).resolves.toBe(true)

      const { data } = mockUpdate.mock.calls[0][0]
      expect(data).not.toHaveProperty('extractedOtp')
      expect(data.categories).toEqual(['Security'])
    })

    it('ignores an OTP the model volunteers when the regex already found one', async () => {
      mockFindUnique.mockResolvedValue(
        baseMessage({
          extractedOtp: '654321',
          text: 'Code: 654321. Your sign-in token: 111111',
          bodyText: null,
        }),
      )
      mockEnrich.mockResolvedValue(otpResult('111111', 'Your sign-in token: 111111'))
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty('extractedOtp')
    })

    it('treats "no code found" as a normal answer: no refund, no retry, nothing stored', async () => {
      const { CommercialProvider } = await import('@/lib/commercial/provider')
      mockEnrich.mockResolvedValue(otpResult(null))
      const { enrichMessage } = await import('../enrichment')

      await expect(enrichMessage('msg-1')).resolves.toBe(true)

      expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty('extractedOtp')
      expect(CommercialProvider.quota.refund).not.toHaveBeenCalled()
    })

    it('does not run at all when the plan excludes LLM enrichment', async () => {
      mockResolve.mockResolvedValue(planWithEnrichment(false))
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockEnrich).not.toHaveBeenCalled()
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    describe('evidence', () => {
      const cases: Array<[string, string, string | null]> = [
        ['is missing', SENTENCE, null],
        ['is not in the body', SENTENCE, 'Your one-time code is 851079'],
        ['describes a promo code', 'Use promo code 851079 to verify your discount', 'Use promo code 851079 to verify your discount'],
        ['shows no one-time-code signal', 'Your reference is 851079', 'Your reference is 851079'],
      ]

      it.each(cases)('drops the code when the evidence %s', async (_label, body, evidence) => {
        mockFindUnique.mockResolvedValue(baseMessage({ text: '', bodyText: body }))
        mockEnrich.mockResolvedValue(otpResult('851079', evidence))
        const { enrichMessage } = await import('../enrichment')

        await expect(enrichMessage('msg-1')).resolves.toBe(true)

        const { data } = mockUpdate.mock.calls[0][0]
        expect(data).not.toHaveProperty('extractedOtp')
        expect(data.categories).toEqual(['Security'])
      })
    })

    describe('Security gate', () => {
      beforeEach(() => {
        mockFindUnique.mockResolvedValue(baseMessage({ text: '', bodyText: SENTENCE }))
      })

      it('drops a valid-looking code when the model did not classify the email as Security', async () => {
        mockEnrich.mockResolvedValue(otpResult('851079', SENTENCE, ['Promotions']))
        const { enrichMessage } = await import('../enrichment')

        await expect(enrichMessage('msg-1')).resolves.toBe(true)

        const { data } = mockUpdate.mock.calls[0][0]
        expect(data).not.toHaveProperty('extractedOtp')
        expect(data.categories).toEqual(['Promotions'])
      })

      it('keeps the code when Security is one of the two categories', async () => {
        mockEnrich.mockResolvedValue(otpResult('851079', SENTENCE, ['Notifications', 'Security']))
        const { enrichMessage } = await import('../enrichment')
        await enrichMessage('msg-1')

        expect(mockUpdate.mock.calls[0][0].data.extractedOtp).toBe('851079')
      })
    })

    it('logs whether a code was recovered, never the code or its evidence', async () => {
      mockFindUnique.mockResolvedValue(baseMessage({ text: '', bodyText: SENTENCE }))
      mockEnrich.mockResolvedValue(otpResult('851079', SENTENCE))
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ otpProposed: true, otpRecovered: true }),
        '[enrichMessage] done',
      )
      const everythingLogged = JSON.stringify([
        mockLogger.info.mock.calls,
        mockLogger.warn.mock.calls,
        mockLogger.error.mock.calls,
      ])
      expect(everythingLogged).not.toContain('851079')
    })

    it('distinguishes "proposed but rejected" from "nothing proposed" in the logs', async () => {
      mockFindUnique.mockResolvedValue(baseMessage({ text: '', bodyText: SENTENCE }))
      mockEnrich.mockResolvedValue(otpResult('851079', SENTENCE, ['Promotions']))
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ otpProposed: true, otpRecovered: false }),
        '[enrichMessage] done',
      )
    })

    it('logs otpProposed: false when the regex already found a code and the model was not asked', async () => {
      mockFindUnique.mockResolvedValue(baseMessage({ extractedOtp: '654321' }))
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ otpProposed: false, otpRecovered: false }),
        '[enrichMessage] done',
      )
    })
  })
})

