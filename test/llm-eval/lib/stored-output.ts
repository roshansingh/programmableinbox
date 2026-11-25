import fs from 'node:fs'
import { RUN_MODES } from './types'
import type { Action, Observed, RunMode, SectionMeta, Snapshot, StoredOutput, StoredSection } from './types'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Returns null when the file does not exist; throws, naming the file, when it is malformed. */
export function readStoredOutput(file: string): StoredOutput | null {
  if (!fs.existsSync(file)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`)
  }
  if (!isObject(parsed)) {
    throw new Error(`${file} must contain a JSON object with "withoutLlm" and/or "withLlm"`)
  }

  const output: StoredOutput = {}
  for (const mode of RUN_MODES) {
    const section = parsed[mode]
    if (section === undefined) continue
    if (!isObject(section)) throw new Error(`${file}: "${mode}" must be an object`)
    output[mode] = section as unknown as StoredSection
  }
  return output
}

export function toSection(
  snapshot: Snapshot,
  meta: SectionMeta,
  extras?: { samples: number; observed: Observed },
): StoredSection {
  return { ...snapshot, ...extras, _generated: meta }
}

/** Read-merge-write: replaces only `mode`'s section and always writes withoutLlm first. */
export function writeSection(file: string, mode: RunMode, section: StoredSection): void {
  const merged: StoredOutput = { ...(readStoredOutput(file) ?? {}), [mode]: section }
  const ordered: StoredOutput = {}
  for (const key of RUN_MODES) {
    if (merged[key]) ordered[key] = merged[key]
  }
  fs.writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`)
}

/**
 * What to do with one (case, mode) run.
 *  - withLlm with no provider configured: skip — never generate, never fail.
 *  - update requested, or no stored section yet: generate.
 *  - otherwise: compare against the stored section. A stored section is never
 *    overwritten without an explicit update.
 */
export function planAction(input: {
  stored: StoredOutput | null
  mode: RunMode
  llmConfigured: boolean
  update: boolean
}): Action {
  if (input.mode === 'withLlm' && !input.llmConfigured) return 'skip'
  if (input.update) return 'generate'
  return input.stored?.[input.mode] ? 'compare' : 'generate'
}
