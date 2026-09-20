import fs from 'node:fs'
import { EMAIL_CATEGORIES, type EmailCategory } from '@/lib/llm/types'
import type { Snapshot } from './types'

/**
 * What the case's author says is correct, independent of any model. Report-only:
 * it is never compared in a way that can fail a run (see Report.recordBaseline).
 */
export interface Intent {
  categories: EmailCategory[]
  otp: string | null
  note?: string
}

const KEYS = new Set(['categories', 'otp', 'note'])

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Strict on purpose: a misspelt key ("categorys") must not silently vanish. */
export function parseIntent(raw: unknown, file: string): Intent {
  if (!isObject(raw)) throw new Error(`${file} must contain a JSON object`)
  for (const key of Object.keys(raw)) {
    if (!KEYS.has(key)) throw new Error(`${file}: unknown key "${key}" (expected categories, otp, note)`)
  }
  const { categories, otp, note } = raw
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error(`${file}: "categories" must be a non-empty array`)
  }
  for (const category of categories) {
    if (!(EMAIL_CATEGORIES as readonly string[]).includes(category as string)) {
      throw new Error(`${file}: "${String(category)}" is not a category (expected one of: ${EMAIL_CATEGORIES.join(', ')})`)
    }
  }
  if (otp !== null && typeof otp !== 'string') throw new Error(`${file}: "otp" must be a string or null`)
  if (note !== undefined && typeof note !== 'string') throw new Error(`${file}: "note" must be a string`)
  return { categories: categories as EmailCategory[], otp, ...(note !== undefined ? { note } : {}) }
}

export function readIntent(file: string | null): Intent | null {
  if (!file) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`)
  }
  return parseIntent(parsed, file)
}

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort()

/** Human-readable lines where the baseline differs from what the author intended. */
export function intentDisagreements(intent: Intent, baseline: Snapshot): string[] {
  const lines: string[] = []
  // An empty category list means the LLM never ran (a withoutLlm-only baseline),
  // not that it answered "nothing": there is nothing to compare.
  if (baseline.categories.length > 0) {
    const want = sortedSet(intent.categories)
    const got = sortedSet(baseline.categories)
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      lines.push(`categories: intended ${JSON.stringify(want)}, baseline ${JSON.stringify(got)}`)
    }
  }
  if (intent.otp !== baseline.extractedOtp) {
    lines.push(`otp: intended ${JSON.stringify(intent.otp)}, baseline ${JSON.stringify(baseline.extractedOtp)}`)
  }
  return lines
}
