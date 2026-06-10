import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EnrichmentResult } from '../types'

const mockEnrich = vi.fn<() => Promise<EnrichmentResult>>()
const mockGetProvider = vi.fn()
const mockCanUse = vi.fn()
const mockFindUnique = vi.fn()
const mockUpdate = vi.fn()

vi.mock('../factory', () => ({ getProvider: mockGetProvider }))
vi.mock('@/lib/commercial/provider', () => ({
  CommercialProvider: { entitlements: { canUse: mockCanUse } },
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
    mockCanUse.mockResolvedValue(true)
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

  it('skips when org is not entitled', async () => {
    mockCanUse.mockResolvedValue(false)
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('skips when metadata is already set (idempotency)', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'msg-1', subject: 'Re', text: 'body', metadata: {}, organizationId: 'org-1',
    })
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(mockEnrich).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('does not throw when provider.enrich rejects', async () => {
    mockEnrich.mockRejectedValue(new Error('rate limit'))
    const { enrichMessage } = await import('../enrichment')
    await expect(enrichMessage('msg-1')).resolves.toBeUndefined()
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
