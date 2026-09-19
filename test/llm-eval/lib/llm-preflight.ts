import { LLM_PROVIDERS } from '@/lib/config'

export type LlmPreflight =
  /** Provider and credential are both usable: the `withLlm` run can go ahead. */
  | { status: 'configured'; note: string }
  /** Nothing (or not yet everything) set: `withLlm` is skipped, deliberately. */
  | { status: 'unconfigured'; note: string }
  /** Set to something `lib/config` would reject: `withLlm` must fail, not skip. */
  | { status: 'invalid'; note: string }

type LlmEnv = { LLM_PROVIDER?: string; LLM_API_KEY?: string }

/**
 * Mirrors what `lib/config/schema.ts` (`LlmSchema`) will accept, so the runner
 * can tell "not set up yet" from "set up wrong" before `enrichMessage` swallows
 * the config error.
 *
 * The provider is validated *before* the missing-key check. Checking the key
 * first reads `LLM_PROVIDER=opnai` with a blank key as "unconfigured, skip":
 * the run reports SKIPPED, `factory.test.ts`'s "a typo must throw" guarantee
 * never gets exercised, and the eval looks healthy while never touching the LLM.
 *
 * Blank counts as unset (as in `lib/config/primitives.ts`), but anything else
 * must match the enum exactly: the schema's `z.enum` neither trims nor folds
 * case, so neither does this.
 */
export function resolveLlmPreflight(env: LlmEnv): LlmPreflight {
  const provider = env.LLM_PROVIDER?.trim() === '' ? undefined : env.LLM_PROVIDER
  if (!provider) {
    return {
      status: 'unconfigured',
      note: 'LLM not configured: set LLM_PROVIDER (and LLM_API_KEY) in .env.eval',
    }
  }

  if (!(LLM_PROVIDERS as readonly string[]).includes(provider)) {
    return {
      status: 'invalid',
      note: `LLM_PROVIDER=${JSON.stringify(provider)} is not a recognised provider (expected one of: ${LLM_PROVIDERS.join(', ')})`,
    }
  }

  // Every provider except ollama needs an API key. "Provider set, key blank"
  // (an unedited .env.eval.example) is unconfigured rather than invalid.
  if (provider !== 'ollama' && !env.LLM_API_KEY?.trim()) {
    return {
      status: 'unconfigured',
      note: `LLM_PROVIDER=${provider} is set but LLM_API_KEY is empty (set it in .env.eval)`,
    }
  }

  return { status: 'configured', note: `LLM_PROVIDER=${provider}` }
}
