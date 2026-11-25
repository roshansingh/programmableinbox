import fs from 'node:fs'
import type { CaseDir } from './types'

export interface CaseInput {
  html: string
  text: string
  /** From subject.txt; null means "derive it" (the HTML <title>, then the folder name). */
  subject: string | null
}

const read = (file: string | null): string => (file ? fs.readFileSync(file, 'utf8') : '')

/** The first non-empty line of subject.txt, trimmed; null when absent or blank. */
export function readSubjectFile(file: string | null): string | null {
  if (!file) return null
  const first = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.trim() !== '')
  return first ? first.trim() : null
}

export function readCaseInput(c: CaseDir): CaseInput {
  return { html: read(c.htmlPath), text: read(c.textPath), subject: readSubjectFile(c.subjectPath) }
}
