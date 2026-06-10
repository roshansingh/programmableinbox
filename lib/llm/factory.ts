import type { LLMProvider } from './types'
import { AnthropicAdapter } from './providers/anthropic'
import { OpenAICompatAdapter } from './providers/openai-compat'

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

export function getProvider(): LLMProvider | null {
  const provider = process.env.LLM_PROVIDER
  if (!provider) return null

  const apiKey = process.env.LLM_API_KEY ?? ''
  const model = process.env.LLM_MODEL || DEFAULT_MODELS[provider] || ''
  const baseURL = process.env.LLM_BASE_URL || DEFAULT_BASE_URLS[provider]

  switch (provider) {
    case 'anthropic':
      return new AnthropicAdapter(apiKey, model)
    case 'openai':
    case 'openrouter':
    case 'ollama':
      return new OpenAICompatAdapter(apiKey, model, baseURL)
    default:
      return null
  }
}
