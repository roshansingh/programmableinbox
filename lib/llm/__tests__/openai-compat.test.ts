import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
const MockOpenAI = vi.fn().mockImplementation(function (this: { chat: { completions: { create: typeof mockCreate } } }) {
  this.chat = { completions: { create: mockCreate } }
})

vi.mock('openai', () => ({
  default: MockOpenAI,
}))

describe('OpenAICompatAdapter', () => {
  beforeEach(() => {
    vi.resetModules()
    mockCreate.mockReset()
    MockOpenAI.mockClear()
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

  it('passes baseURL when provided', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ categories: ['Primary'], extractedOtp: null, metadata: { links: [], timestamps: [] } }) } }],
    })

    const { OpenAICompatAdapter } = await import('../providers/openai-compat')
    new OpenAICompatAdapter('key', 'llama3.2', 'http://localhost:11434/v1')

    expect(MockOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'http://localhost:11434/v1' })
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
})
