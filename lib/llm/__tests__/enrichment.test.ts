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

vi.mock('../factory', () => ({ getProvider: mockGetProvider }))
vi.mock('@/lib/commercial/provider', () => ({
  CommercialProvider: { plans: { resolve: mockResolve } },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    emailMessage: { findUnique: mockFindUnique, update: mockUpdate },
  },
}))

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
    mockFindUnique.mockResolvedValue({
      id: 'msg-1',
      subject: 'Your OTP',
      text: 'Code: 654321',
      metadata: null,
      organizationId: 'org-1',
    })
    mockEnrich.mockResolvedValue(ENRICHMENT_RESULT)
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
