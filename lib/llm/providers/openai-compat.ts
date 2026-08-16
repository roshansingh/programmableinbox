import OpenAI from 'openai'
import type { LLMProvider, EnrichmentResult } from '../types'
import { parseEnrichmentResult } from '../types'
import { buildSystemPrompt } from '../prompt'
import logger from '@/lib/logger'

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

    const choice = response.choices[0]
    const content = choice?.message?.content ?? ''
    const finishReason = choice?.finish_reason
    const refusal = choice?.message?.refusal

    // A non-'stop' finish or an explicit refusal both silently degrade to an
    // empty EnrichmentResult below (same shape as "nothing to extract"), so
    // without this the two are indistinguishable in the data. Reasoning
    // models in particular can spend the whole max_completion_tokens budget
    // on hidden reasoning and return empty content with finish_reason:
    // 'length' — that looks identical to a well-formed "nothing found"
    // answer unless it's logged here.
    if ((finishReason && finishReason !== 'stop') || refusal) {
      logger.warn(
        { model: this.model, finishReason, refusal, contentLength: content.length },
        '[OpenAICompatAdapter] enrich response was not a clean stop — enrichment result may be empty',
      )
    }

    // Strip <think>…</think> blocks emitted by reasoning models before JSON parsing
    const stripped = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    try {
      return parseEnrichmentResult(JSON.parse(stripped))
    } catch (error) {
      logger.warn(
        { model: this.model, finishReason, contentLength: content.length, error },
        '[OpenAICompatAdapter] failed to parse enrichment JSON from response',
      )
      return parseEnrichmentResult(null)
    }
  }
}
