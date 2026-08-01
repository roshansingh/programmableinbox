import type { LLMProvider } from './types'
import { config, resetConfigCache, type LlmProviderName } from '@/lib/config'
import { AnthropicAdapter } from './providers/anthropic'
import { OpenAICompatAdapter } from './providers/openai-compat'

const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  ollama: 'llama3.2',
}

const DEFAULT_BASE_URLS: Partial<Record<LlmProviderName, string>> = {
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
}

let _cachedProvider: LLMProvider | null | undefined = undefined
let _cachedProviderKey: string | undefined = undefined

export function getProvider(): LLMProvider | null {
  const { provider, apiKey, model, baseUrl } = config.llm
  const providerKey = [
    provider ?? '',
    apiKey?.reveal() ?? '',
    model ?? '',
    baseUrl ?? '',
  ].join(':')

  if (_cachedProviderKey === providerKey) {
    return _cachedProvider ?? null
  }

  _cachedProviderKey = providerKey
  _cachedProvider = buildProvider()
  return _cachedProvider ?? null
}

export function resetProviderCache(): void {
  // Config memoizes per domain, so clearing only the local cache would rebuild
  // the provider from the same stale parse.
  resetConfigCache()
  _cachedProvider = undefined
  _cachedProviderKey = undefined
}

function buildProvider(): LLMProvider | null {
  const { provider, apiKey, model, baseUrl } = config.llm

  // Enrichment is opt-in: no provider configured means the feature is off.
  //
  // An *unrecognised* provider is a different situation and no longer reaches
  // here — the config schema rejects it, so a typo in LLM_PROVIDER now reports
  // a misconfiguration instead of silently disabling enrichment via the
  // `default:` branch this switch used to need.
  if (!provider) return null

  const key = apiKey?.reveal() ?? ''
  const resolvedModel = model ?? DEFAULT_MODELS[provider]
  const resolvedBaseUrl = baseUrl ?? DEFAULT_BASE_URLS[provider]

  switch (provider) {
    case 'anthropic':
      return new AnthropicAdapter(key, resolvedModel)
    case 'openai':
    case 'openrouter':
      return new OpenAICompatAdapter(key, resolvedModel, resolvedBaseUrl)
    case 'ollama':
      return new OpenAICompatAdapter(key, resolvedModel, resolvedBaseUrl, { think: false })
  }
}
