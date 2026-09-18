import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enrichMessage } from '@/lib/llm/enrichment'
import type { LlmEnrichmentResult } from '@/lib/llm/types'
import { buildRow, toSnapshot } from './build-row'
import { compareSnapshots } from './compare'
import { recorder, store } from './shared'
import { readStoredOutput, toSection, writeSection } from './stored-output'

/**
 * The successful withLlm path — provider -> merge -> row update -> snapshot ->
 * output.json section -> compare — with no API key. The runner's own runs can
 * only exercise it when a real provider is configured, so this is the only
 * place it executes on every self-test run. Everything is real code except the
 * two seams the runner also fakes: the Prisma calls (an in-memory RowStore) and
 * the provider (a canned result each test sets).
 */
const holder = vi.hoisted(() => ({ result: undefined as unknown as LlmEnrichmentResult }))

vi.mock('@/lib/db', async () => {
  const { store } = await import('./shared')
  return { prisma: store.prismaShim() }
})

vi.mock('@/lib/llm/factory', async () => {
  const { recorder } = await import('./shared')
  const { recordingProvider } = await import('./recording-provider')
  const provider = { enrich: async () => holder.result }
  return {
    getProvider: () => recordingProvider(provider, recorder),
    resetProviderCache: () => {},
  }
})

// Equal to test/llm-eval/cases/*/email.html.
const SIGNIN_TOKEN_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Your Acme sign-in token</title>
  </head>
  <body>
    <p>Use sign-in token <strong>A1B2C3</strong> to continue signing in to Acme.</p>
    <p>This token expires in 10 minutes. Never share it with anyone.</p>
  </body>
</html>
`

const PROMO_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Spring sale: 25% off everything</title>
  </head>
  <body>
    <h1>Spring sale</h1>
    <p>Use discount code <strong>SPRING25</strong> at checkout for 25% off your order.</p>
    <p><a href="https://shop.example.com/sale">Shop the sale</a></p>
    <p><a href="https://shop.example.com/unsubscribe">Unsubscribe</a></p>
  </body>
</html>
`

const SIGNIN_EVIDENCE = 'Use sign-in token A1B2C3 to continue signing in to Acme.'
const PROMO_EVIDENCE = 'Use discount code SPRING25 at checkout for 25% off your order.'

const result = (over: Partial<LlmEnrichmentResult>): LlmEnrichmentResult => ({
  categories: ['Notifications'],
  ctaJudgments: [],
  timestamps: [],
  otp: null,
  otpEvidence: null,
  ...over,
})

async function runWithLlm(html: string, fake: LlmEnrichmentResult) {
  holder.result = fake
  const row = buildRow({ id: 'case:withLlm', caseId: 'case', html })
  store.insert(row)
  const settled = await enrichMessage(row.id)
  return { row, settled, snapshot: toSnapshot(store.get(row.id)!) }
}

beforeEach(() => {
  store.clear()
  recorder.reset()
  holder.result = undefined as unknown as LlmEnrichmentResult
})

describe('withLlm success path', () => {
  it('recovers an OTP the regex missed, with categories and timestamps', async () => {
    const { row, settled, snapshot } = await runWithLlm(
      SIGNIN_TOKEN_HTML,
      result({
        categories: ['Security'],
        timestamps: ['in 10 minutes'],
        otp: 'A1B2C3',
        otpEvidence: SIGNIN_EVIDENCE,
      }),
    )

    expect(row.extractedOtp).toBeNull() // the regex really missed it
    expect(settled).toBe(true)
    expect(recorder.errors).toEqual([])
    expect(recorder.calls).toHaveLength(1)
    expect(recorder.calls[0].options).toEqual({ extractOtp: true })
    expect(snapshot.extractedOtp).toBe('A1B2C3')
    expect(snapshot.categories).toEqual(['Security'])
    expect(snapshot.metadata.timestamps).toEqual(['in 10 minutes'])
  })

  it('merges a CTA judgment onto the low-confidence link by candidate index', async () => {
    const { row, settled, snapshot } = await runWithLlm(
      PROMO_HTML,
      result({ categories: ['Promotions'], ctaJudgments: [{ i: 0, isCta: true }] }),
    )

    const before = row.metadata.links.find((link) => link.url === 'https://shop.example.com/sale')
    const after = snapshot.metadata.links.find((link) => link.url === 'https://shop.example.com/sale')
    expect(before).toMatchObject({ isCta: false, ctaConfidence: 'low' })
    expect(settled).toBe(true)
    expect(after).toMatchObject({ label: 'Shop the sale', isCta: true, ctaConfidence: 'high' })
    // The other link was not a candidate, so it is left exactly as ingestion stored it.
    expect(snapshot.metadata.links).toHaveLength(row.metadata.links.length)
    expect(snapshot.metadata.links.find((link) => link.url.endsWith('/unsubscribe'))).toEqual(
      row.metadata.links.find((link) => link.url.endsWith('/unsubscribe')),
    )
  })

  describe('a discount code is never stored as an OTP', () => {
    it('when the model does not tag the email Security', async () => {
      const { row, settled, snapshot } = await runWithLlm(
        PROMO_HTML,
        result({ categories: ['Promotions'], otp: 'SPRING25', otpEvidence: PROMO_EVIDENCE }),
      )

      expect(row.extractedOtp).toBeNull()
      expect(settled).toBe(true)
      expect(recorder.calls[0].options).toEqual({ extractOtp: true }) // the model was asked and proposed it
      expect(snapshot.extractedOtp).toBeNull()
    })

    it('even when the model does tag the email Security (the evidence disqualifiers hold)', async () => {
      const { settled, snapshot } = await runWithLlm(
        PROMO_HTML,
        result({ categories: ['Security'], otp: 'SPRING25', otpEvidence: PROMO_EVIDENCE }),
      )

      expect(settled).toBe(true)
      expect(recorder.calls[0].result.otp).toBe('SPRING25')
      expect(snapshot.categories).toEqual(['Security'])
      expect(snapshot.extractedOtp).toBeNull()
    })
  })
})

describe('round trip through output.json', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-eval-pipeline-'))
    file = path.join(dir, 'output.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const META = { at: '2026-01-01T00:00:00.000Z', model: 'test:model' }

  async function stored() {
    const { snapshot } = await runWithLlm(
      SIGNIN_TOKEN_HTML,
      result({
        categories: ['Security', 'Notifications'],
        timestamps: ['in 10 minutes'],
        otp: 'A1B2C3',
        otpEvidence: SIGNIN_EVIDENCE,
      }),
    )
    writeSection(file, 'withLlm', toSection(snapshot, META))
    return { snapshot, section: readStoredOutput(file)!.withLlm! }
  }

  it('a section written from a run compares clean against that same run', async () => {
    const { snapshot, section } = await stored()

    const comparison = compareSnapshots('withLlm', section, snapshot)

    expect(comparison.failures).toEqual([])
    expect(comparison.informational).toEqual([])
  })

  it('ignores category order', async () => {
    const { snapshot, section } = await stored()

    const comparison = compareSnapshots('withLlm', section, {
      ...snapshot,
      categories: [...snapshot.categories].reverse(),
    })

    expect(snapshot.categories).toEqual(['Security', 'Notifications'])
    expect(comparison.failures).toEqual([])
  })

  it('fails on a different extractedOtp, at that path only', async () => {
    const { snapshot, section } = await stored()

    const comparison = compareSnapshots('withLlm', section, { ...snapshot, extractedOtp: '000000' })

    expect(comparison.failures.map((diff) => diff.path)).toEqual(['extractedOtp'])
  })

  it('reports different timestamps as one informational diff and no failure', async () => {
    const { snapshot, section } = await stored()

    const comparison = compareSnapshots('withLlm', section, {
      ...snapshot,
      metadata: { ...snapshot.metadata, timestamps: ['in ten minutes'] },
    })

    expect(comparison.failures).toEqual([])
    expect(comparison.informational).toHaveLength(1)
    expect(comparison.informational[0].path).toBe('metadata.timestamps[0]')
  })

  it('writing a withLlm section leaves an existing withoutLlm section unchanged', async () => {
    const withoutLlm = toSnapshot(buildRow({ id: 'case:withoutLlm', caseId: 'case', html: SIGNIN_TOKEN_HTML }))
    writeSection(file, 'withoutLlm', toSection(withoutLlm, { at: META.at, model: null }))
    const before = JSON.stringify(readStoredOutput(file)!.withoutLlm, null, 2)

    await stored()

    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(JSON.stringify(raw.withoutLlm, null, 2)).toBe(before)
    expect(Object.keys(raw)).toEqual(['withoutLlm', 'withLlm'])
  })
})
