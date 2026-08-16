import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
const MockOpenAI = vi.fn().mockImplementation(function (this: { chat: { completions: { create: typeof mockCreate } } }) {
  this.chat = { completions: { create: mockCreate } }
})
const mockLoggerWarn = vi.fn()

vi.mock('openai', () => ({
  default: MockOpenAI,
}))
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: mockLoggerWarn, error: vi.fn() },
}))

describe('OpenAICompatAdapter', () => {
  beforeEach(() => {
    vi.resetModules()
    mockCreate.mockReset()
    MockOpenAI.mockClear()
    mockLoggerWarn.mockReset()
  })

  it('returns enrichment result from JSON response', async () => {
    const payload = {
      categories: ['Promotions'],
      extractedOtp: null,
      metadata: {
        links: [{ url: 'https://shop.example.com', label: 'Shop Now', isCta: true }],
        timestamps: [],
      },
    }
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-4o-mini')
    const result = await adapter.enrich('Summer Sale!', 'Get 50% off today')

    expect(result.categories).toEqual(['Promotions'])
    expect(result.extractedOtp).toBeNull()
    expect(result.metadata.links[0].label).toBe('Shop Now')
  })

  it('passes baseURL when provided and omits it when not', async () => {
    const { OpenAICompatAdapter } = await import('../providers/openai-compat')

    // with baseURL
    new OpenAICompatAdapter('key', 'llama3.2', 'http://localhost:11434/v1')
    expect(MockOpenAI).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseURL: 'http://localhost:11434/v1' })
    )

    // without baseURL — should NOT have baseURL key
    MockOpenAI.mockClear()
    new OpenAICompatAdapter('key', 'model')
    expect(MockOpenAI).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ baseURL: expect.anything() })
    )
  })

  it('returns safe default when response content is malformed JSON', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'not json at all' } }],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-4o-mini')
    const result = await adapter.enrich('Hi', 'Hello')

    expect(result.categories).toEqual([])
    expect(result.extractedOtp).toBeNull()
  })

  it('logs a warning with the finish_reason and content length when JSON parsing fails', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: 'not json at all', refusal: null } }],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-4o-mini')
    await adapter.enrich('Hi', 'Hello')

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini', finishReason: 'stop', contentLength: 'not json at all'.length }),
      expect.stringContaining('failed to parse'),
    )
  })

  it('logs a warning when the response was truncated before completion (finish_reason: length)', async () => {
    // Reasoning models can spend their entire max_completion_tokens budget on
    // hidden reasoning tokens, leaving no room to emit the JSON answer — the
    // response comes back empty with finish_reason: 'length' rather than an error.
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'length', message: { content: '', refusal: null } }],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-5.4-mini')
    const result = await adapter.enrich('Your verification code', 'Enter this code: 745804')

    expect(result.categories).toEqual([])
    expect(result.extractedOtp).toBeNull()
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.4-mini', finishReason: 'length' }),
      expect.stringContaining('not a clean stop'),
    )
  })

  it('logs a warning with the refusal message when the model declines to answer', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: null, refusal: "I can't help extract a verification code." },
        },
      ],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-5.4-mini')
    const result = await adapter.enrich('Your verification code', 'Enter this code: 745804')

    expect(result.categories).toEqual([])
    expect(result.extractedOtp).toBeNull()
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.4-mini',
        refusal: "I can't help extract a verification code.",
      }),
      expect.stringContaining('not a clean stop'),
    )
  })

  it('does not warn on a clean successful response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              categories: ['Security'],
              extractedOtp: '745804',
              metadata: { links: [], timestamps: [] },
            }),
            refusal: null,
          },
        },
      ],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-4o-mini')
    await adapter.enrich('Your verification code', 'Enter this code: 745804')

    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})
