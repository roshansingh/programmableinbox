import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../providers/anthropic', () => ({
  AnthropicAdapter: vi.fn().mockImplementation(function (key: string, model: string) {
    return { _type: 'anthropic', key, model }
  }),
}))

vi.mock('../providers/openai-compat', () => ({
  OpenAICompatAdapter: vi.fn().mockImplementation(function (key: string, model: string, baseURL: string | undefined) {
    return { _type: 'openai-compat', key, model, baseURL }
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

  it('throws for unknown provider instead of returning null', async () => {
    vi.stubEnv('LLM_PROVIDER', 'unknown-provider')
    const { getProvider } = await import('../factory')
    expect(() => getProvider()).toThrow()
  })
})
