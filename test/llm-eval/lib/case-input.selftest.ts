import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCaseInput, readSubjectFile } from './case-input'
import type { CaseDir } from './types'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-eval-input-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const write = (name: string, content: string): string => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, content)
  return file
}

const caseOf = (over: Partial<CaseDir>): CaseDir => ({
  id: 'c',
  dir,
  htmlPath: null,
  textPath: null,
  subjectPath: null,
  intentPath: null,
  outputPath: path.join(dir, 'output.json'),
  ...over,
})

describe('readSubjectFile', () => {
  it('returns null when there is no file', () => {
    expect(readSubjectFile(null)).toBeNull()
  })

  it('returns the first non-empty line, trimmed', () => {
    expect(readSubjectFile(write('subject.txt', '\n  Re: Saturday hike?  \nignored\n'))).toBe('Re: Saturday hike?')
  })

  it('returns null for a blank file so the caller falls back', () => {
    expect(readSubjectFile(write('blank.txt', '  \n\n'))).toBeNull()
  })

  it('keeps emoji and non-Latin text intact', () => {
    expect(readSubjectFile(write('s.txt', '📦 تم شحن طلبك\n'))).toBe('📦 تم شحن طلبك')
  })
})

describe('readCaseInput', () => {
  it('reads whichever parts exist and gives an empty string for the rest', () => {
    const htmlPath = write('email.html', '<p>hi</p>')

    expect(readCaseInput(caseOf({ htmlPath }))).toEqual({ html: '<p>hi</p>', text: '', subject: null })
  })

  it('reads a text-only case', () => {
    const textPath = write('email.txt', 'plain body')

    expect(readCaseInput(caseOf({ textPath }))).toEqual({ html: '', text: 'plain body', subject: null })
  })

  it('reads both parts and the subject of a multipart case', () => {
    const htmlPath = write('email.html', '<p>rich</p>')
    const textPath = write('email.txt', 'stub')
    const subjectPath = write('subject.txt', 'Hello')

    expect(readCaseInput(caseOf({ htmlPath, textPath, subjectPath }))).toEqual({
      html: '<p>rich</p>',
      text: 'stub',
      subject: 'Hello',
    })
  })
})
