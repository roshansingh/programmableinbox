import type { LLMProvider } from './types'
import { AnthropicAdapter } from './providers/anthropic'
import { OpenAICompatAdapter } from './providers/openai-compat'
import { config } from '@/lib/config'

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  ollama: 'llama3.2',
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
}

let _cachedProvider: LLMProvider | null | undefined = undefined
let _cachedProviderKey: string | undefined = undefined

export function getProvider(): LLMProvider | null {
  const { provider, apiKey, model, baseUrl } = config.llm
  const providerKey = [provider ?? '', apiKey?.reveal() ?? '', model ?? '', baseUrl ?? ''].join(':')

  if (_cachedProviderKey === providerKey) {
    return _cachedProvider ?? null
  }

  _cachedProviderKey = providerKey
  _cachedProvider = buildProvider()
  return _cachedProvider ?? null
}

export function resetProviderCache(): void {
  _cachedProvider = undefined
  _cachedProviderKey = undefined
}

function buildProvider(): LLMProvider | null {
  const { provider, apiKey, model, baseUrl } = config.llm
  if (!provider) return null

  const rawApiKey = apiKey?.reveal() ?? ''
  const resolvedModel = model || DEFAULT_MODELS[provider] || ''
  const resolvedBaseUrl = baseUrl || DEFAULT_BASE_URLS[provider]

  switch (provider) {
    case 'anthropic':
      return new AnthropicAdapter(rawApiKey, resolvedModel)
    case 'openai':
    case 'openrouter':
      return new OpenAICompatAdapter(rawApiKey, resolvedModel, resolvedBaseUrl)
    case 'ollama':
      return new OpenAICompatAdapter(rawApiKey, resolvedModel, resolvedBaseUrl, { think: false })
  }
}
