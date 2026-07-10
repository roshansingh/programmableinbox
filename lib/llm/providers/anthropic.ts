import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, EnrichmentResult } from '../types'
import { ENRICHMENT_JSON_SCHEMA, parseEnrichmentResult } from '../types'
import { buildSystemPrompt } from '../prompt'

export class AnthropicAdapter implements LLMProvider {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model = 'claude-haiku-4-5-20251001') {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async enrich(subject: string, bodyText: string): Promise<EnrichmentResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      messages: [
        { role: 'user', content: `Subject: ${subject}\n\nBody:\n${bodyText.slice(0, 4000)}` },
      ],
      tools: [
        {
          name: 'enrich_email',
          description: 'Extract categories and metadata from the email',
          input_schema: ENRICHMENT_JSON_SCHEMA as unknown as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: 'enrich_email' },
    })

    const toolUse = response.content.find((c) => c.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return parseEnrichmentResult(null)
    }
    return parseEnrichmentResult(toolUse.input)
  }
}
