import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(function (this: { messages: { create: typeof mockCreate } }) {
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
            ctaJudgments: [{ url: 'https://example.com/verify', isCta: true }],
            timestamps: [],
          },
        },
      ],
    })

    const { AnthropicAdapter } = await import('../providers/anthropic')
    const adapter = new AnthropicAdapter('test-key')
    const result = await adapter.enrich('Your OTP is 123456', 'Use code 123456 to verify.', [
      { url: 'https://example.com/verify', label: 'Verify' },
    ])

    expect(result.categories).toEqual(['Security'])
    expect(result.ctaJudgments).toEqual([{ url: 'https://example.com/verify', isCta: true }])
  })

  it('includes the candidate links in the user message sent to the model', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'enrich_email', input: { categories: [], ctaJudgments: [], timestamps: [] } }],
    })

    const { AnthropicAdapter } = await import('../providers/anthropic')
    const adapter = new AnthropicAdapter('test-key')
    await adapter.enrich('Hi', 'Hello', [{ url: 'https://example.com/x', label: 'Learn more' }])

    const call = mockCreate.mock.calls[0][0]
    expect(call.messages[0].content).toContain('https://example.com/x')
    expect(call.messages[0].content).toContain('Learn more')
  })

  it('returns empty result when no tool_use block in response', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'sorry' }] })

    const { AnthropicAdapter } = await import('../providers/anthropic')
    const adapter = new AnthropicAdapter('test-key')
    const result = await adapter.enrich('Hi', 'Hello', [])

    expect(result.categories).toEqual([])
    expect(result.ctaJudgments).toEqual([])
  })

  it('uses provided model when specified', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'enrich_email',
          input: { categories: ['Primary'], ctaJudgments: [], timestamps: [] },
        },
      ],
    })

    const { AnthropicAdapter } = await import('../providers/anthropic')
    const adapter = new AnthropicAdapter('test-key', 'claude-opus-4-8')
    await adapter.enrich('Hello', 'World', [])

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-8' })
    )
  })
})
