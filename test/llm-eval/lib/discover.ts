import fs from 'node:fs'
import path from 'node:path'
import type { CaseDir } from './types'

export const EMAIL_HTML_FILE = 'email.html'
export const EMAIL_TEXT_FILE = 'email.txt'
export const SUBJECT_FILE = 'subject.txt'
export const INTENT_FILE = 'intent.json'
export const OUTPUT_FILE = 'output.json'

const existing = (dir: string, name: string): string | null => {
  const file = path.join(dir, name)
  return fs.existsSync(file) ? file : null
}

/**
 * A case is any folder that directly contains an `email.html` and/or an
 * `email.txt` (both = a multipart message). Folders may be nested to group
 * cases (`security/otp-1`), and the id is the path relative to `root`. A case
 * folder is a leaf: nothing beneath it is searched.
 */
export function discoverCases(root: string): CaseDir[] {
  if (!fs.existsSync(root)) throw new Error(`Cases directory does not exist: ${root}`)

  const found: CaseDir[] = []

  const walk = (dir: string): void => {
    const htmlPath = existing(dir, EMAIL_HTML_FILE)
    const textPath = existing(dir, EMAIL_TEXT_FILE)
    if (dir !== root && (htmlPath || textPath)) {
      found.push({
        id: path.relative(root, dir).split(path.sep).join('/'),
        dir,
        htmlPath,
        textPath,
        subjectPath: existing(dir, SUBJECT_FILE),
        intentPath: existing(dir, INTENT_FILE),
        outputPath: path.join(dir, OUTPUT_FILE),
      })
      return
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name))
    }
  }

  walk(root)
  return found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
