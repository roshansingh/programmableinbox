import OpenAI from 'openai'
import type { LLMProvider, LlmEnrichmentResult, CandidateLink } from '../types'
import { parseEnrichmentResult } from '../types'
import { buildSystemPrompt, buildUserMessage } from '../prompt'
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

  async enrich(subject: string, bodyText: string, candidateLinks: CandidateLink[]): Promise<LlmEnrichmentResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserMessage(subject, bodyText, candidateLinks) },
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
    const warnedNonCleanStop = (finishReason && finishReason !== 'stop') || !!refusal
    if (warnedNonCleanStop) {
      logger.warn(
        { model: this.model, finishReason, refusal, contentLength: content.length },
        '[OpenAICompatAdapter] enrich response was not a clean stop — enrichment result may be empty',
      )
    }

    // finish_reason: 'length' means the budget ran out before the model
    // finished — checked unconditionally, before attempting to parse, because
    // a truncated response is not always syntactically broken. The model can
    // stop mid-generation at a point that happens to close valid JSON (e.g.
    // just `{"categories":["Security"]}`, missing ctaJudgments/timestamps) —
    // JSON.parse would succeed on that and parseEnrichmentResult would
    // silently default the missing fields, so checking finishReason only
    // inside the catch block (as an earlier version of this fix did) would
    // miss exactly that case and persist a partial result as if complete.
    // Throw so the caller (lib/llm/enrichment.ts) takes its existing
    // transient-failure path: refund the unit and leave the message eligible
    // for retry, instead of quietly accepting less than what was asked for.
    if (finishReason === 'length') {
      logger.error(
        { model: this.model, finishReason, contentLength: content.length },
        '[OpenAICompatAdapter] enrichment response truncated before completion',
      )
      throw new Error(`OpenAICompatAdapter: response truncated (finish_reason: length, ${content.length} chars)`)
    }

    // Strip <think>…</think> blocks emitted by reasoning models before JSON parsing
    const stripped = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    try {
      return parseEnrichmentResult(JSON.parse(stripped))
    } catch (error) {
      // Empty content after a non-clean-stop/refusal always fails JSON.parse('') —
      // that's the same failure already warned about above, not a second one.
      if (!warnedNonCleanStop || stripped) {
        logger.warn(
          { model: this.model, finishReason, contentLength: content.length, error },
          '[OpenAICompatAdapter] failed to parse enrichment JSON from response',
        )
      }
      return parseEnrichmentResult(null)
    }
  }
}
