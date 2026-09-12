import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
const mockLoggerError = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(function (this: { messages: { create: typeof mockCreate } }) {
      this.messages = { create: mockCreate }
    }),
  }
})
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError },
}))

describe('AnthropicAdapter', () => {
  beforeEach(() => {
    vi.resetModules()
    mockCreate.mockReset()
    mockLoggerError.mockReset()
  })

  it('returns enrichment result from tool_use response', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: 'enrich_email',
          input: {
            categories: ['Security'],
            ctaJudgments: [{ i: 0, isCta: true }],
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
    expect(result.ctaJudgments).toEqual([{ i: 0, isCta: true }])
  })

  it('includes the candidate links, numbered by index, in the user message sent to the model', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'enrich_email', input: { categories: [], ctaJudgments: [], timestamps: [] } }],
    })

    const { AnthropicAdapter } = await import('../providers/anthropic')
    const adapter = new AnthropicAdapter('test-key')
    await adapter.enrich('Hi', 'Hello', [{ url: 'https://example.com/x', label: 'Learn more' }])

    const call = mockCreate.mock.calls[0][0]
    expect(call.messages[0].content).toContain('0: https://example.com/x')
    expect(call.messages[0].content).toContain('Learn more')
  })

  it('throws when the response was truncated before completing the tool call (stop_reason: max_tokens)', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'max_tokens',
      content: [{ type: 'tool_use', name: 'enrich_email', input: { categories: ['Security'] } }],
    })

    const { AnthropicAdapter } = await import('../providers/anthropic')
    const adapter = new AnthropicAdapter('test-key')

    // Same reasoning as OpenAICompatAdapter: a partial tool call could be
    // silently missing ctaJudgments entries near the end with no signal that
    // anything was dropped — the caller must refund quota and retry, not
    // persist a partial result as if it were complete.
    await expect(adapter.enrich('Hi', 'Hello', [])).rejects.toThrow(/truncated/)
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ stopReason: 'max_tokens' }),
      expect.stringContaining('truncated'),
    )
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
