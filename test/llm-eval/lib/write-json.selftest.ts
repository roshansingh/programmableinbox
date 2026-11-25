import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeJsonFile } from './write-json'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-eval-write-json-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('writeJsonFile', () => {
  it('writes pretty-printed JSON with a trailing newline', () => {
    const file = path.join(dir, 'result.json')

    writeJsonFile(file, { a: 1, b: [2] })

    expect(fs.readFileSync(file, 'utf8')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n')
  })

  it('creates a parent directory that does not exist, however deep', () => {
    const file = path.join(dir, 'out', 'nested', 'qwen3-8b.json')

    writeJsonFile(file, { ok: true })

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ ok: true })
  })

  it('overwrites an existing file, so the last write wins', () => {
    const file = path.join(dir, 'result.json')

    writeJsonFile(file, { n: 1 })
    writeJsonFile(file, { n: 2 })

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ n: 2 })
  })
})
