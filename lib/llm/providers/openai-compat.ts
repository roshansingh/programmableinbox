import OpenAI from 'openai'
import type { LLMProvider, EnrichmentResult } from '../types'
import { parseEnrichmentResult } from '../types'
import { buildSystemPrompt } from '../prompt'

export class OpenAICompatAdapter implements LLMProvider {
  private client: OpenAI
  private model: string
  private extraBody: Record<string, unknown>

  constructor(apiKey: string, model: string, baseURL?: string, extraBody: Record<string, unknown> = {}) {
    // OpenAI SDK requires a non-empty apiKey even when the server (e.g. Ollama) doesn't validate it
    this.client = new OpenAI({ apiKey: apiKey || 'no-key', ...(baseURL ? { baseURL } : {}) })
    this.model = model
    this.extraBody = extraBody
  }

  async enrich(subject: string, bodyText: string): Promise<EnrichmentResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: `Subject: ${subject}\n\nBody:\n${bodyText.slice(0, 4000)}` },
      ],
      ...this.extraBody,
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)

    const content = response.choices[0]?.message?.content ?? ''
    // Strip <think>…</think> blocks emitted by reasoning models before JSON parsing
    const stripped = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    try {
      return parseEnrichmentResult(JSON.parse(stripped))
    } catch {
      return parseEnrichmentResult(null)
    }
  }
}
