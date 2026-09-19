import fs from 'node:fs'
import path from 'node:path'
import type { CaseDir } from './types'

export const EMAIL_FILE = 'email.html'
export const OUTPUT_FILE = 'output.json'

/**
 * A case is any folder that directly contains an `email.html`. Folders may be
 * nested to group cases (`security/otp-1`), and the id is the path relative to
 * `root`. A case folder is a leaf: nothing beneath it is searched.
 */
export function discoverCases(root: string): CaseDir[] {
  if (!fs.existsSync(root)) throw new Error(`Cases directory does not exist: ${root}`)

  const found: CaseDir[] = []

  const walk = (dir: string): void => {
    if (dir !== root && fs.existsSync(path.join(dir, EMAIL_FILE))) {
      found.push({
        id: path.relative(root, dir).split(path.sep).join('/'),
        dir,
        htmlPath: path.join(dir, EMAIL_FILE),
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
