import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { enrichMessage } from '@/lib/llm/enrichment'
import { resetProviderCache } from '@/lib/llm/factory'
import { summarize, type BenchOutcome, type BenchRef, type BenchRun } from './lib/bench'
import { buildRow, toSnapshot } from './lib/build-row'
import { readCaseInput } from './lib/case-input'
import { discoverCases } from './lib/discover'
import { readIntent } from './lib/intent'
import { resolveLlmPreflight } from './lib/llm-preflight'
import { classifyLlmRun } from './lib/run-outcome'
import { recorder, store } from './lib/shared'
import { readStoredOutput } from './lib/stored-output'

/**
 * Benchmarks ONE configured model (LLM_PROVIDER / LLM_MODEL, from the shell or
 * .env.eval) over every case, once each, and measures it against the stored
 * gpt-4o-mini baselines and the authors' intent. It is not a regression guard:
 * nothing here can fail because a model is bad, only because the benchmark
 * itself cannot run.
 *
 *   LLM_PROVIDER=ollama LLM_API_KEY= LLM_MODEL=qwen3:8b BENCH_OUT=out.json npm run eval:email:bench
 *
 * Blank LLM_API_KEY matters for a local model: .env.eval usually carries an
 * OpenAI key, and a shell value (even empty) wins over the file.
 *
 * BENCH_OUT     write the full result (runs + summary) as JSON
 * BENCH_LIMIT   only the first N cases (for a model too slow to run them all)
 * BENCH_TIMEOUT_MS  give up on one call after this long (default 180000)
 */

// Same seams as the eval runner: only the Prisma calls are faked.
vi.mock('@/lib/db', async () => {
  const { store } = await import('./lib/shared')
  return { prisma: store.prismaShim() }
})

vi.mock('@/lib/llm/factory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/factory')>()
  const { recorder } = await import('./lib/shared')
  const { recordingProvider } = await import('./lib/recording-provider')
  return {
    ...actual,
    getProvider: () => {
      const inner = actual.getProvider()
      return inner ? recordingProvider(inner, recorder) : null
    },
  }
})

// The adapter does not surface token usage, so read it off the HTTP response
// (OpenAI-compatible servers all return `usage`). Installed before any client exists.
let usage: { prompt: number | null; completion: number | null } = { prompt: null, completion: null }
const realFetch = globalThis.fetch
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  const response = await realFetch(...args)
  try {
    const body = (await response.clone().json()) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }
    if (body?.usage) usage = { prompt: body.usage.prompt_tokens ?? null, completion: body.usage.completion_tokens ?? null }
  } catch {
    // not JSON (or streaming): no usage to record
  }
  return response
}) as typeof fetch

const CASES_ROOT = path.resolve(__dirname, 'cases')
const provider = process.env.LLM_PROVIDER
const model = process.env.LLM_MODEL
const preflight = resolveLlmPreflight({ LLM_PROVIDER: provider, LLM_API_KEY: process.env.LLM_API_KEY })
const label = process.env.BENCH_LABEL ?? `${provider ?? 'none'}:${model ?? 'default'}`
const timeoutMs = Number(process.env.BENCH_TIMEOUT_MS ?? 180_000)
const limit = process.env.BENCH_LIMIT ? Number(process.env.BENCH_LIMIT) : undefined

const allCases = discoverCases(CASES_ROOT)
const cases = limit === undefined ? allCases : allCases.slice(0, limit)

const runs: BenchRun[] = []
const refs: Record<string, BenchRef> = {}
let runToken = 0

async function benchOne(id: string, input: ReturnType<typeof readCaseInput>): Promise<BenchRun> {
  const token = ++runToken
  resetProviderCache()
  recorder.reset()
  store.clear()
  usage = { prompt: null, completion: null }

  const row = buildRow({ id: `${id}:bench`, caseId: id, html: input.html, text: input.text, subject: input.subject })
  store.insert(row)
  const lowUrls = row.metadata.links.filter((link) => link.ctaConfidence === 'low').map((link) => link.url)
  const base = { caseId: id, regexOtp: row.extractedOtp, lowUrls }

  const started = performance.now()
  let timer: NodeJS.Timeout | undefined
  const raced = await Promise.race([
    enrichMessage(row.id).then((settled) => ({ kind: 'done' as const, settled })),
    new Promise<{ kind: 'timeout' }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs)
    }),
  ])
  clearTimeout(timer)
  const ms = Math.round(performance.now() - started)

  if (raced.kind === 'timeout' || token !== runToken) {
    return { ...base, outcome: 'timeout', ms, promptTokens: null, completionTokens: null, snapshot: null }
  }

  const outcome = classifyLlmRun({ settled: raced.settled, errors: recorder.errors, calls: recorder.calls })
  const kind: BenchOutcome = outcome.kind === 'failed' ? 'failed' : outcome.kind
  return {
    ...base,
    outcome: kind,
    reason: outcome.kind === 'failed' ? outcome.reason : undefined,
    ms,
    promptTokens: usage.prompt,
    completionTokens: usage.completion,
    snapshot: kind === 'failed' ? null : toSnapshot(store.get(row.id)!),
  }
}

describe(`benchmark ${label}`, () => {
  afterAll(() => {
    const summary = summarize(runs, refs)
    const result = { label, provider: provider ?? null, model: model ?? null, at: new Date().toISOString(), cases: runs.length, summary, runs }
    if (process.env.BENCH_OUT) fs.writeFileSync(process.env.BENCH_OUT, `${JSON.stringify(result, null, 2)}\n`)
    const pct = (n: number, d = summary.cases) => `${n}/${d} (${d === 0 ? 0 : Math.round((100 * n) / d)}%)`
    process.stdout.write(
      [
        '',
        `Benchmark: ${label}   (${summary.cases} cases)`,
        `  usable answers        ${pct(summary.usable)}   [no valid category ${summary.noCategories}, failed ${summary.failed}, timeout ${summary.timeout}]`,
        `  categories seen by baseline  ${pct(summary.categoriesSeen)}   exactly the baseline mode ${pct(summary.categoriesMode)}`,
        `  categories vs intent  exact ${pct(summary.categoriesIntent)}   covers ${pct(summary.coversIntent)}`,
        `  OTP  matches baseline ${pct(summary.otpMatchesBaseline)}   model-stored false ${summary.llmFalseOtp}, wrong ${summary.llmWrongOtp}, recovered ${summary.recovered}/${summary.recoverable}`,
        `  links agree ${pct(summary.linksAgree, summary.linksJudged)}   skipped ${summary.linksSkipped}`,
        `  latency  median ${summary.latency.medianMs}ms  p95 ${summary.latency.p95Ms}ms  total ${Math.round(summary.latency.totalMs / 1000)}s   tokens/call  prompt ${summary.tokens.meanPrompt} completion ${summary.tokens.meanCompletion}`,
        '',
      ].join('\n'),
    )
  })

  it('is configured to reach a model', () => {
    expect(preflight.status, preflight.note).toBe('configured')
  })

  for (const c of cases) {
    it(c.id, { timeout: timeoutMs + 30_000 }, async () => {
      if (preflight.status !== 'configured') throw new Error(preflight.note)
      const input = readCaseInput(c)
      refs[c.id] = { intent: readIntent(c.intentPath), baseline: readStoredOutput(c.outputPath)?.withLlm ?? null }
      runs.push(await benchOne(c.id, input))
    })
  }
})
