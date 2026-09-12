import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
const MockOpenAI = vi.fn().mockImplementation(function (this: { chat: { completions: { create: typeof mockCreate } } }) {
  this.chat = { completions: { create: mockCreate } }
})
const mockLoggerWarn = vi.fn()
const mockLoggerError = vi.fn()

vi.mock('openai', () => ({
  default: MockOpenAI,
}))
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: mockLoggerWarn, error: mockLoggerError },
}))

describe('OpenAICompatAdapter', () => {
  beforeEach(() => {
    vi.resetModules()
    mockCreate.mockReset()
    MockOpenAI.mockClear()
    mockLoggerWarn.mockReset()
    mockLoggerError.mockReset()
  })

  it('returns enrichment result from JSON response', async () => {
    const payload = {
      categories: ['Promotions'],
      ctaJudgments: [{ i: 0, isCta: true }],
      timestamps: [],
    }
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-4o-mini')
    const result = await adapter.enrich('Summer Sale!', 'Get 50% off today', [
      { url: 'https://shop.example.com', label: 'Shop Now' },
    ])

    expect(result.categories).toEqual(['Promotions'])
    expect(result.ctaJudgments).toEqual([{ i: 0, isCta: true }])
  })

  it('includes the candidate links, numbered by index, in the user message sent to the model', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ categories: [], ctaJudgments: [], timestamps: [] }) } }],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-4o-mini')
    await adapter.enrich('Hi', 'Hello', [{ url: 'https://example.com/x', label: 'Learn more' }])

    const call = mockCreate.mock.calls[0][0]
    const userMessage = call.messages.find((m: { role: string }) => m.role === 'user').content
    expect(userMessage).toContain('0: https://example.com/x')
    expect(userMessage).toContain('Learn more')
  })

  it('omits the candidate links section from the user message when there are none', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ categories: [], ctaJudgments: [], timestamps: [] }) } }],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-4o-mini')
    await adapter.enrich('Hi', 'Hello', [])

    const call = mockCreate.mock.calls[0][0]
    const userMessage = call.messages.find((m: { role: string }) => m.role === 'user').content
    expect(userMessage).not.toContain('Candidate links')
  })

  it('passes baseURL when provided and omits it when not', async () => {
    const { OpenAICompatAdapter } = await import('../providers/openai-compat')

    new OpenAICompatAdapter('key', 'llama3.2', 'http://localhost:11434/v1')
    expect(MockOpenAI).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseURL: 'http://localhost:11434/v1' })
    )

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
    const result = await adapter.enrich('Hi', 'Hello', [])

    expect(result.categories).toEqual([])
    expect(result.ctaJudgments).toEqual([])
  })

  it('logs a warning with the finish_reason and content length when JSON parsing fails', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: 'not json at all', refusal: null } }],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-4o-mini')
    await adapter.enrich('Hi', 'Hello', [])

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini', finishReason: 'stop', contentLength: 'not json at all'.length }),
      expect.stringContaining('failed to parse'),
    )
  })

  it('throws when the response was truncated before completion (finish_reason: length), rather than silently returning empty', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'length', message: { content: '', refusal: null } }],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-5.4-mini')

    // A truncated response must not be indistinguishable from a genuine
    // "nothing to extract" answer — the caller (lib/llm/enrichment.ts) relies
    // on the throw to refund the spent quota unit and leave the message
    // eligible for retry instead of marking it permanently enriched with
    // nothing.
    await expect(
      adapter.enrich('Your verification code', 'Enter this code: 745804', []),
    ).rejects.toThrow(/truncated/)
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.4-mini', finishReason: 'length' }),
      expect.stringContaining('not a clean stop'),
    )
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.4-mini', finishReason: 'length' }),
      expect.stringContaining('truncated'),
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
    const result = await adapter.enrich('Your verification code', 'Enter this code: 745804', [])

    expect(result.categories).toEqual([])
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.4-mini',
        refusal: "I can't help extract a verification code.",
      }),
      expect.stringContaining('not a clean stop'),
    )
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
  })

  it('throws (does not just warn) when a length-truncated response has non-empty unparseable content', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'length', message: { content: '{"categ', refusal: null } }],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-5.4-mini')

    await expect(adapter.enrich('Hi', 'Hello', [])).rejects.toThrow(/truncated/)
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ finishReason: 'length' }),
      expect.stringContaining('not a clean stop'),
    )
    // The generic "failed to parse" warning is specific to non-length parse
    // failures (e.g. finish_reason: 'stop' with garbage content) — a length
    // truncation gets its own error log + throw instead, not both.
    expect(mockLoggerWarn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('failed to parse'),
    )
  })

  it('throws even when the truncated content happens to be syntactically valid JSON, missing required fields', async () => {
    // The model stopped generating right after closing `categories` — that's
    // valid JSON on its own (JSON.parse would succeed and parseEnrichmentResult
    // would silently default the missing ctaJudgments/timestamps), but it's
    // still an incomplete answer to a truncated generation. The check must run
    // unconditionally on finishReason, not only inside a JSON.parse catch.
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'length', message: { content: '{"categories":["Security"]}', refusal: null } }],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-4o-mini')

    await expect(adapter.enrich('Hi', 'Hello', [])).rejects.toThrow(/truncated/)
  })

  it('does not warn on a clean successful response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({ categories: ['Security'], ctaJudgments: [], timestamps: [] }),
            refusal: null,
          },
        },
      ],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    const adapter = new OpenAICompatAdapter('test-key', 'gpt-4o-mini')
    await adapter.enrich('Your verification code', 'Enter this code: 745804', [])

    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})
