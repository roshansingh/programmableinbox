import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, LlmEnrichmentResult, CandidateLink, EnrichOptions } from '../types'
import { buildEnrichmentJsonSchema, parseEnrichmentResult } from '../types'
import { buildSystemPrompt, buildUserMessage } from '../prompt'
import logger from '@/lib/logger'

export class AnthropicAdapter implements LLMProvider {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model = 'claude-haiku-4-5-20251001') {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async enrich(
    subject: string,
    bodyText: string,
    candidateLinks: CandidateLink[],
    options: EnrichOptions = {},
  ): Promise<LlmEnrichmentResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: buildSystemPrompt(options),
      messages: [
        { role: 'user', content: buildUserMessage(subject, bodyText, candidateLinks) },
      ],
      tools: [
        {
          name: 'enrich_email',
          // Both the description and the schema mention a one-time code only
          // when this request asks for one — see buildEnrichmentJsonSchema.
          description: options.extractOtp
            ? 'Classify email categories, judge which candidate links are calls to action, and report a one-time code if the email contains one'
            : 'Classify email categories and judge which candidate links are calls to action',
          input_schema: buildEnrichmentJsonSchema(options) as unknown as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: 'enrich_email' },
    })

    // Same reasoning as OpenAICompatAdapter: 'max_tokens' means generation
    // was cut off before the tool call finished, so `toolUse.input` (if
    // present at all) may be missing entries with no way to tell which ones
    // were dropped — silently accepting a partial result risks losing real
    // CTA judgments without any signal. Throw so the caller refunds the
    // quota unit and retries rather than marking this settled.
    if (response.stop_reason === 'max_tokens') {
      logger.error(
        { model: this.model, stopReason: response.stop_reason },
        '[AnthropicAdapter] enrichment response truncated before completing the tool call',
      )
      throw new Error('AnthropicAdapter: response truncated (stop_reason: max_tokens)')
    }

    const toolUse = response.content.find((c) => c.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return parseEnrichmentResult(null)
    }
    return parseEnrichmentResult(toolUse.input)
  }
}
