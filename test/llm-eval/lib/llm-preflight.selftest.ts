import { describe, expect, it } from 'vitest'
import { resolveLlmPreflight } from './llm-preflight'

describe('resolveLlmPreflight', () => {
  it('is unconfigured when no provider is set', () => {
    const result = resolveLlmPreflight({})

    expect(result.status).toBe('unconfigured')
    expect(result.note).toMatch(/set LLM_PROVIDER/)
  })

  it('treats a blank provider as unset, like lib/config', () => {
    expect(resolveLlmPreflight({ LLM_PROVIDER: '   ', LLM_API_KEY: 'k' }).status).toBe(
      'unconfigured',
    )
  })

  it.each(['anthropic', 'openai', 'openrouter'])(
    'is configured for %s with a key',
    (provider) => {
      expect(resolveLlmPreflight({ LLM_PROVIDER: provider, LLM_API_KEY: 'sk-test' }).status).toBe(
        'configured',
      )
    },
  )

  it.each([undefined, '', '   '])(
    'is unconfigured for a hosted provider whose key is %j, naming the key',
    (key) => {
      const result = resolveLlmPreflight({ LLM_PROVIDER: 'openai', LLM_API_KEY: key })

      expect(result.status).toBe('unconfigured')
      expect(result.note).toContain('LLM_PROVIDER=openai')
      expect(result.note).toContain('LLM_API_KEY is empty')
    },
  )

  it('is configured for ollama without a key', () => {
    expect(resolveLlmPreflight({ LLM_PROVIDER: 'ollama' }).status).toBe('configured')
  })

  it('is invalid for an unknown provider even when the key is blank', () => {
    // The regression: a typo with an unedited key used to read as "skipped", so
    // the enum check lib/config runs at boot never happened.
    const result = resolveLlmPreflight({ LLM_PROVIDER: 'unknown-provider', LLM_API_KEY: '' })

    expect(result.status).toBe('invalid')
    expect(result.note).toContain('LLM_PROVIDER="unknown-provider"')
    expect(result.note).toContain('anthropic, openai, openrouter, ollama')
  })

  it('is invalid for an unknown provider that has a key', () => {
    expect(resolveLlmPreflight({ LLM_PROVIDER: 'unknown-provider', LLM_API_KEY: 'k' }).status).toBe(
      'invalid',
    )
  })

  it.each(['OpenAI', ' openai', 'openai '])('matches the enum exactly: %j is invalid', (value) => {
    // lib/config's z.enum is case- and whitespace-sensitive, so the preflight
    // must be too, or it would accept a value the app rejects at boot.
    expect(resolveLlmPreflight({ LLM_PROVIDER: value, LLM_API_KEY: 'k' }).status).toBe('invalid')
  })
})
