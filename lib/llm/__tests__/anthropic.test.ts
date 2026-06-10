import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      this.messages = { create: mockCreate }
    }),
  }
})

describe('AnthropicAdapter', () => {
  beforeEach(() => {
    vi.resetModules()
    mockCreate.mockReset()
  })

  it('returns enrichment result from tool_use response', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'enrich_email',
          input: {
            categories: ['Security'],
            extractedOtp: '123456',
            metadata: {
              links: [{ url: 'https://example.com/verify', isCta: true }],
              timestamps: [],
            },
          },
        },
      ],
    })

    const { AnthropicAdapter } = await import('../providers/anthropic')
    const adapter = new AnthropicAdapter('test-key')
    const result = await adapter.enrich('Your OTP is 123456', 'Use code 123456 to verify.')

    expect(result.categories).toEqual(['Security'])
    expect(result.extractedOtp).toBe('123456')
    expect(result.metadata.links).toHaveLength(1)
    expect(result.metadata.links[0].isCta).toBe(true)
  })

  it('returns empty result when no tool_use block in response', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'sorry' }] })

    const { AnthropicAdapter } = await import('../providers/anthropic')
    const adapter = new AnthropicAdapter('test-key')
    const result = await adapter.enrich('Hi', 'Hello')

    expect(result.categories).toEqual([])
    expect(result.extractedOtp).toBeNull()
    expect(result.metadata.links).toEqual([])
  })

  it('uses provided model when specified', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'enrich_email',
          input: { categories: ['Primary'], extractedOtp: null, metadata: { links: [], timestamps: [] } },
        },
      ],
    })

    const { AnthropicAdapter } = await import('../providers/anthropic')
    const adapter = new AnthropicAdapter('test-key', 'claude-opus-4-8')
    await adapter.enrich('Hello', 'World')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-8' })
    )
  })
})
