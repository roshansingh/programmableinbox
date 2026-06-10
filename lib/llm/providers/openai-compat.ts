import OpenAI from 'openai'
import type { LLMProvider, EnrichmentResult } from '../types'
import { parseEnrichmentResult } from '../types'
import { buildSystemPrompt } from '../prompt'

export class OpenAICompatAdapter implements LLMProvider {
  private client: OpenAI
  private model: string

  constructor(apiKey: string, model: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
    this.model = model
  }

  async enrich(subject: string, bodyText: string): Promise<EnrichmentResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: `Subject: ${subject}\n\nBody:\n${bodyText.slice(0, 4000)}` },
      ],
    })

    const content = response.choices[0]?.message?.content ?? ''
    try {
      return parseEnrichmentResult(JSON.parse(content))
    } catch {
      return parseEnrichmentResult(null)
    }
  }
}
