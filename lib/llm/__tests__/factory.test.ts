import { describe, it, expect, vi, afterEach } from 'vitest'
import { MAX_COMPLETION_TOKENS } from '../types'

vi.mock('../providers/anthropic', () => ({
  AnthropicAdapter: vi.fn().mockImplementation(function (key: string, model: string) {
    return { _type: 'anthropic', key, model }
  }),
}))

vi.mock('../providers/openai-compat', () => ({
  OpenAICompatAdapter: vi.fn().mockImplementation(function (
    key: string,
    model: string,
    baseURL: string | undefined,
    extraBody: Record<string, unknown> | undefined,
  ) {
    return { _type: 'openai-compat', key, model, baseURL, extraBody }
  }),
}))

describe('getProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns null when LLM_PROVIDER is not set', async () => {
    vi.stubEnv('LLM_PROVIDER', '')
    const { getProvider } = await import('../factory')
    expect(getProvider()).toBeNull()
  })

  it('returns AnthropicAdapter for provider=anthropic', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LLM_API_KEY', 'sk-ant-test')
    const { getProvider } = await import('../factory')
    const provider = getProvider() as any
    expect(provider._type).toBe('anthropic')
    expect(provider.key).toBe('sk-ant-test')
  })

  it('uses LLM_MODEL override when set', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LLM_API_KEY', 'key')
    vi.stubEnv('LLM_MODEL', 'claude-opus-4-8')
    const { getProvider } = await import('../factory')
    const provider = getProvider() as any
    expect(provider.model).toBe('claude-opus-4-8')
  })

  it('returns OpenAICompatAdapter for provider=openai', async () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    vi.stubEnv('LLM_API_KEY', 'sk-openai')
    const { getProvider } = await import('../factory')
    const provider = getProvider() as any
    expect(provider._type).toBe('openai-compat')
    expect(provider.baseURL).toBeUndefined()
  })

  it('returns OpenAICompatAdapter with ollama baseURL for provider=ollama', async () => {
    vi.stubEnv('LLM_PROVIDER', 'ollama')
    vi.stubEnv('LLM_API_KEY', '')
    const { getProvider } = await import('../factory')
    const provider = getProvider() as any
    expect(provider._type).toBe('openai-compat')
    expect(provider.baseURL).toBe('http://localhost:11434/v1')
  })

  // Ollama's OpenAI-compatible /v1 endpoint silently ignores two things the
  // adapter would otherwise rely on, so each is pinned to the name it honours
  // (measured on 0.32.5). Asserting the whole body keeps any of them from
  // quietly becoming a no-op again:
  //  - `think: false` -> ~1,300 chars of hidden reasoning per call regardless;
  //    `reasoning_effort: 'none'` is what turns it off.
  //  - `max_completion_tokens` -> asking for 50 tokens returned 75, so a
  //    runaway generation was unbounded (one stalled the server for 5 minutes);
  //    `max_tokens` is enforced.
  //  - temperature is unset, which Ollama samples at 1.0: 4 distinct outputs
  //    across 5 identical requests. 0 makes an extraction repeatable.
  it('sends the ollama request body that /v1 actually honours', async () => {
    vi.stubEnv('LLM_PROVIDER', 'ollama')
    vi.stubEnv('LLM_API_KEY', '')
    const { getProvider } = await import('../factory')
    const provider = getProvider() as any
    expect(provider.extraBody).toEqual({
      reasoning_effort: 'none',
      max_tokens: MAX_COMPLETION_TOKENS,
      temperature: 0,
    })
  })

  it('sends no extra request body to providers that are not ollama', async () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    vi.stubEnv('LLM_API_KEY', 'sk-openai')
    const { getProvider } = await import('../factory')
    const provider = getProvider() as any
    expect(provider.extraBody).toBeUndefined()
  })

  it('uses LLM_BASE_URL override for ollama', async () => {
    vi.stubEnv('LLM_PROVIDER', 'ollama')
    vi.stubEnv('LLM_BASE_URL', 'http://my-ollama:11434/v1')
    const { getProvider } = await import('../factory')
    const provider = getProvider() as any
    expect(provider.baseURL).toBe('http://my-ollama:11434/v1')
  })

  it('returns OpenAICompatAdapter with openrouter baseURL for provider=openrouter', async () => {
    vi.stubEnv('LLM_PROVIDER', 'openrouter')
    vi.stubEnv('LLM_API_KEY', 'or-key')
    const { getProvider } = await import('../factory')
    const provider = getProvider() as any
    expect(provider._type).toBe('openai-compat')
    expect(provider.baseURL).toBe('https://openrouter.ai/api/v1')
  })

  it('throws on an unknown provider instead of silently disabling enrichment', async () => {
    // A typo in LLM_PROVIDER used to hit the switch's `default:` branch and
    // return null, which is indistinguishable from "enrichment is turned off".
    vi.stubEnv('LLM_PROVIDER', 'unknown-provider')
    const { getProvider } = await import('../factory')
    expect(() => getProvider()).toThrow(/LLM_PROVIDER/)
  })

  it('returns null when no provider is configured, which is how it is disabled', async () => {
    vi.stubEnv('LLM_PROVIDER', '')
    const { getProvider } = await import('../factory')
    expect(getProvider()).toBeNull()
  })

  it('throws when a hosted provider is set without an API key', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LLM_API_KEY', '')
    const { getProvider } = await import('../factory')
    expect(() => getProvider()).toThrow(/LLM_API_KEY/)
  })
})
