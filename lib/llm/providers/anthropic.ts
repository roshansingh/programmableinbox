import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, LlmEnrichmentResult, CandidateLink } from '../types'
import { ENRICHMENT_JSON_SCHEMA, parseEnrichmentResult } from '../types'
import { buildSystemPrompt, buildUserMessage } from '../prompt'

export class AnthropicAdapter implements LLMProvider {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model = 'claude-haiku-4-5-20251001') {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async enrich(subject: string, bodyText: string, candidateLinks: CandidateLink[]): Promise<LlmEnrichmentResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      messages: [
        { role: 'user', content: buildUserMessage(subject, bodyText, candidateLinks) },
      ],
      tools: [
        {
          name: 'enrich_email',
          description: 'Classify email categories and judge which candidate links are calls to action',
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
