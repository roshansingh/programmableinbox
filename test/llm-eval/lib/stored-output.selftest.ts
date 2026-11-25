import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planAction, readStoredOutput, toSection, writeSection } from './stored-output'
import type { Snapshot, StoredOutput } from './types'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-eval-stored-'))
  file = path.join(dir, 'output.json')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const snapshot = (otp: string | null): Snapshot => ({
  extractedOtp: otp,
  categories: [],
  metadata: { links: [], timestamps: [] },
})
const META = { at: '2026-09-18T00:00:00.000Z', model: null }

describe('readStoredOutput', () => {
  it('returns null when the file does not exist', () => {
    expect(readStoredOutput(file)).toBeNull()
  })

  it('reads the sections that are present', () => {
    fs.writeFileSync(file, JSON.stringify({ withoutLlm: snapshot('1') }))

    expect(readStoredOutput(file)).toEqual({ withoutLlm: snapshot('1') })
  })

  it('throws, naming the file, on invalid JSON', () => {
    fs.writeFileSync(file, '{ nope')

    expect(() => readStoredOutput(file)).toThrow(/output\.json is not valid JSON/)
  })

  it('throws when the top level is not an object', () => {
    fs.writeFileSync(file, '[]')

    expect(() => readStoredOutput(file)).toThrow(/must contain a JSON object/)
  })

  it('throws when a section is not an object', () => {
    fs.writeFileSync(file, JSON.stringify({ withLlm: 'x' }))

    expect(() => readStoredOutput(file)).toThrow(/"withLlm" must be an object/)
  })
})

describe('writeSection', () => {
  it('creates the file with just the written section', () => {
    writeSection(file, 'withoutLlm', toSection(snapshot('1'), META))

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      withoutLlm: { ...snapshot('1'), _generated: META },
    })
  })

  it('adds a section without touching the existing one', () => {
    writeSection(file, 'withoutLlm', toSection(snapshot('1'), META))
    const before = readStoredOutput(file)!.withoutLlm

    writeSection(file, 'withLlm', toSection(snapshot('2'), META))

    const after = readStoredOutput(file)!
    expect(after.withoutLlm).toEqual(before)
    expect(after.withLlm?.extractedOtp).toBe('2')
  })

  it('replaces only the section it is given', () => {
    writeSection(file, 'withoutLlm', toSection(snapshot('1'), META))
    writeSection(file, 'withLlm', toSection(snapshot('2'), META))

    writeSection(file, 'withLlm', toSection(snapshot('3'), META))

    const stored = readStoredOutput(file)!
    expect(stored.withoutLlm?.extractedOtp).toBe('1')
    expect(stored.withLlm?.extractedOtp).toBe('3')
  })

  it('writes withoutLlm before withLlm, indented, with a trailing newline', () => {
    writeSection(file, 'withLlm', toSection(snapshot('2'), META))
    writeSection(file, 'withoutLlm', toSection(snapshot('1'), META))

    const text = fs.readFileSync(file, 'utf8')
    expect(Object.keys(JSON.parse(text))).toEqual(['withoutLlm', 'withLlm'])
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "withoutLlm"')
  })
})

describe('toSection', () => {
  it('appends the provenance block after the snapshot fields', () => {
    expect(Object.keys(toSection(snapshot('1'), META))).toEqual([
      'extractedOtp',
      'categories',
      'metadata',
      '_generated',
    ])
  })
})

describe('planAction', () => {
  const stored = (over: StoredOutput = {}): StoredOutput => ({
    withoutLlm: toSection(snapshot('1'), META),
    withLlm: toSection(snapshot('1'), META),
    ...over,
  })

  it.each([
    ['no file yet', null, 'withoutLlm', true, false, 'generate'],
    ['no file yet, LLM on', null, 'withLlm', true, false, 'generate'],
    ['section present', stored(), 'withoutLlm', true, false, 'compare'],
    ['section present, LLM on', stored(), 'withLlm', true, false, 'compare'],
    ['withLlm section missing', stored({ withLlm: undefined }), 'withLlm', true, false, 'generate'],
    ['withoutLlm section missing', stored({ withoutLlm: undefined }), 'withoutLlm', true, false, 'generate'],
    ['update forces regeneration', stored(), 'withoutLlm', true, true, 'generate'],
    ['update forces regeneration, LLM', stored(), 'withLlm', true, true, 'generate'],
    ['LLM not configured skips withLlm', stored(), 'withLlm', false, false, 'skip'],
    ['LLM not configured skips even when missing', null, 'withLlm', false, false, 'skip'],
    ['LLM not configured skips even on update', stored(), 'withLlm', false, true, 'skip'],
    ['LLM not configured does not affect withoutLlm', stored(), 'withoutLlm', false, false, 'compare'],
  ] as const)('%s', (_name, storedOutput, mode, llmConfigured, update, expected) => {
    expect(planAction({ stored: storedOutput, mode, llmConfigured, update })).toBe(expected)
  })
})

describe('toSection with samples', () => {
  const snap: Snapshot = {
    extractedOtp: null,
    categories: ['Travel'],
    metadata: { links: [], timestamps: [] },
  }
  const meta = { at: '2026-09-19T00:00:00.000Z', model: 'openai:gpt-4o-mini' }

  it('adds samples and observed before _generated', () => {
    const observed = {
      categories: [{ value: ['Travel'], count: 5 }],
      extractedOtp: [{ value: null, count: 5 }],
      links: {},
    }
    const section = toSection(snap, meta, { samples: 5, observed })

    expect(Object.keys(section)).toEqual(['extractedOtp', 'categories', 'metadata', 'samples', 'observed', '_generated'])
    expect(section.samples).toBe(5)
  })

  it('is unchanged when there are no extras', () => {
    expect(Object.keys(toSection(snap, meta))).toEqual(['extractedOtp', 'categories', 'metadata', '_generated'])
  })
})
