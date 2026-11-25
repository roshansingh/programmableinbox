import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MAX_COMPLETION_TOKENS } from '../types'

/**
 * What each provider actually puts on the wire: the REAL factory builds the
 * REAL adapter, and only the OpenAI SDK's `chat.completions.create` is faked so
 * its argument can be read. factory.test.ts mocks the adapter and so can only
 * see the extra body handed to its constructor; it cannot notice the adapter
 * failing to spread that body into the request, which is what would silently
 * turn the Ollama settings back into no-ops.
 */
const mockCreate = vi.fn()
const MockOpenAI = vi.fn().mockImplementation(function (this: { chat: { completions: { create: typeof mockCreate } } }) {
  this.chat = { completions: { create: mockCreate } }
})

vi.mock('openai', () => ({ default: MockOpenAI }))
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const RESPONSE = {
  choices: [
    {
      message: { content: JSON.stringify({ categories: ['Primary'], ctaJudgments: [], timestamps: [] }) },
      finish_reason: 'stop',
    },
  ],
}

async function requestFor(provider: string, apiKey: string): Promise<Record<string, unknown>> {
  vi.stubEnv('LLM_PROVIDER', provider)
  vi.stubEnv('LLM_API_KEY', apiKey)
  vi.stubEnv('LLM_MODEL', '')
  vi.stubEnv('LLM_BASE_URL', '')
  const { getProvider } = await import('../factory')
  await getProvider()!.enrich('Subject', 'Body', [])
  expect(mockCreate).toHaveBeenCalledTimes(1)
  return mockCreate.mock.calls[0][0]
}

describe('the request each provider sends', () => {
  beforeEach(() => {
    vi.resetModules()
    mockCreate.mockReset()
    mockCreate.mockResolvedValue(RESPONSE)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('ollama carries the three settings /v1 honours', async () => {
    const body = await requestFor('ollama', '')

    expect(body).toMatchObject({
      reasoning_effort: 'none',
      max_tokens: MAX_COMPLETION_TOKENS,
      temperature: 0,
    })
  })

  it('ollama still sends the adapter\'s own fields alongside them', async () => {
    const body = await requestFor('ollama', '')

    expect(body).toMatchObject({
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      response_format: { type: 'json_object' },
    })
    expect(Array.isArray(body.messages)).toBe(true)
  })

  it('openai sends exactly the request it always has, and none of the ollama-only settings', async () => {
    const body = await requestFor('openai', 'sk-test')

    expect(Object.keys(body).sort()).toEqual(['max_completion_tokens', 'messages', 'model', 'response_format'])
    // Literal 1024 on purpose: changing the cap for OpenAI should be a deliberate edit to this test.
    expect(body).toMatchObject({
      model: 'gpt-4o-mini',
      max_completion_tokens: 1024,
      response_format: { type: 'json_object' },
    })
  })

  it('openrouter sends the same shape as openai', async () => {
    const body = await requestFor('openrouter', 'or-test')

    expect(Object.keys(body).sort()).toEqual(['max_completion_tokens', 'messages', 'model', 'response_format'])
  })
})
