import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EnrichmentResult } from '../types'
import { UNLIMITED } from '@/lib/commercial/plan-limits'

const mockEnrich = vi.fn<() => Promise<EnrichmentResult>>()
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

const ENRICHMENT_RESULT: EnrichmentResult = {
  categories: ['Security'],
  extractedOtp: '654321',
  metadata: { links: [], timestamps: [] },
}

describe('enrichMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProvider.mockReturnValue({ enrich: mockEnrich })
    mockResolve.mockResolvedValue(planWithEnrichment(true))
    mockConsume.mockResolvedValue({ allowed: true, limit: null, used: 0, resetsAt: null })
    mockFindUnique.mockResolvedValue({
      id: 'msg-1',
      subject: 'Your OTP',
      text: 'Code: 654321',
      metadata: null,
      organizationId: 'org-1',
    })
    mockEnrich.mockResolvedValue(ENRICHMENT_RESULT)
  })

  it('wraps enrichment in an OTel span named llm.enrich_message', async () => {
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(startActiveSpanMock).toHaveBeenCalledWith('llm.enrich_message', expect.any(Function))
  })

  it('never throws, even when an unexpected error occurs outside enrichMessageInner\'s own catch-all', async () => {
    // getProvider() runs before enrichMessageInner's try block, so a throw
    // here reaches the span wrapper's catch — the one path that exercises
    // it. enrichMessage's documented contract is to never throw; the span
    // wrapper must preserve that rather than rethrowing.
    mockGetProvider.mockImplementation(() => {
      throw new Error('provider factory misconfigured')
    })
    const { enrichMessage } = await import('../enrichment')

    await expect(enrichMessage('msg-1')).resolves.toBe(false)
  })

  it('writes categories, extractedOtp, and metadata on success', async () => {
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        categories: ['Security'],
        extractedOtp: '654321',
        metadata: { links: [], timestamps: [] },
      },
    })
  })

  /**
   * `text` is empty for HTML-only mail (webhook route sets `text: resendEmail.text || ''`);
   * `bodyText` is derived at ingestion and falls back to HTML-extracted text in that case.
   * Enrichment must read from `bodyText` or an OTP embedded only in the HTML part is invisible
   * to the LLM.
   */
  it('enriches from bodyText, not the raw text field, when text is empty (HTML-only mail)', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'msg-1',
      subject: 'Your ChatGPT code',
      text: '',
      bodyText: 'Enter this temporary verification code to continue: 851079',
      metadata: null,
      organizationId: 'org-1',
    })
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockEnrich).toHaveBeenCalledWith(
      'Your ChatGPT code',
      'Enter this temporary verification code to continue: 851079',
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

  /**
   * Exhausting the enrichment meter is a *settled* skip: retrying would produce
   * the same answer until the period rolls over, so the caller must mark the
   * step done rather than re-queue it forever.
   */
  it('returns settled without calling the provider when the meter is exhausted', async () => {
    mockConsume.mockResolvedValue({ allowed: false, limit: 100, used: 100, resetsAt: null })
    const { enrichMessage } = await import('../enrichment')

    await expect(enrichMessage('msg-1')).resolves.toBe(true)
    expect(mockEnrich).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  /**
   * The provider call is the billable part, so the unit is returned when it
   * fails — otherwise a provider outage silently drains the allowance while
   * producing nothing, and the retry drains it again.
   */
  it('refunds the unit when the provider call fails', async () => {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    mockEnrich.mockRejectedValue(new Error('rate limit'))
    const { enrichMessage } = await import('../enrichment')

    await enrichMessage('msg-1')

    expect(CommercialProvider.quota.refund).toHaveBeenCalledWith('org-1', 'llm.enrichments', 1, expect.anything())
  })

  /**
   * The provider call already happened and was billed. If persisting the
   * result then fails, metadata stays null, so the caller's retry re-runs
   * provider.enrich() and would consume a second unit for the same message
   * unless this failure also refunds the first one.
   */
  it('refunds the unit when the DB write after a successful enrich fails', async () => {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    mockUpdate.mockRejectedValue(new Error('connection reset'))
    const { enrichMessage } = await import('../enrichment')

    await expect(enrichMessage('msg-1')).resolves.toBe(false)

    expect(CommercialProvider.quota.refund).toHaveBeenCalledWith('org-1', 'llm.enrichments', 1, expect.anything())
  })

  it('skips when metadata is already set (idempotency)', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'msg-1', subject: 'Re', text: 'body', metadata: {}, organizationId: 'org-1',
    })
    const { enrichMessage } = await import('../enrichment')
    // A definitive skip is settled → true (nothing to retry).
    await expect(enrichMessage('msg-1')).resolves.toBe(true)

    expect(mockEnrich).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns false (transient failure, do not mark done) when provider.enrich rejects', async () => {
    mockEnrich.mockRejectedValue(new Error('rate limit'))
    const { enrichMessage } = await import('../enrichment')
    // Never throws (best-effort), but signals failure so the caller doesn't
    // permanently mark the step complete.
    await expect(enrichMessage('msg-1')).resolves.toBe(false)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('writes metadata as empty object when enrichment returns no links/timestamps', async () => {
    mockEnrich.mockResolvedValue({
      categories: ['Primary'],
      extractedOtp: null,
      metadata: { links: [], timestamps: [] },
    })
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: { links: [], timestamps: [] } }),
      })
    )
  })
})
