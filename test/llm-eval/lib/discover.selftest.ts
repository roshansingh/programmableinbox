import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverCases } from './discover'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-eval-discover-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function touch(relativePath: string, content = ''): void {
  const file = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

const ids = () => discoverCases(root).map((c) => c.id)

describe('discoverCases', () => {
  it('finds every folder that contains an email.html, sorted by id', () => {
    touch('promo/email.html')
    touch('otp/email.html')

    expect(ids()).toEqual(['otp', 'promo'])
  })

  it('supports grouping folders: the id is the path relative to the root', () => {
    touch('security/otp-1/email.html')
    touch('security/otp-2/email.html')
    touch('marketing/promo/email.html')

    expect(ids()).toEqual(['marketing/promo', 'security/otp-1', 'security/otp-2'])
  })

  it('ignores folders without an email.html and stray files', () => {
    touch('notes/readme.md')
    touch('loose.html')
    touch('real/email.html')

    expect(ids()).toEqual(['real'])
  })

  it('gives each case its html and output.json paths', () => {
    touch('otp/email.html')

    const [found] = discoverCases(root)

    expect(found.dir).toBe(path.join(root, 'otp'))
    expect(found.htmlPath).toBe(path.join(root, 'otp', 'email.html'))
    expect(found.outputPath).toBe(path.join(root, 'otp', 'output.json'))
  })

  it('does not descend into a case folder', () => {
    touch('otp/email.html')
    touch('otp/nested/email.html')

    expect(ids()).toEqual(['otp'])
  })

  it('returns no cases for an empty root and throws for a missing one', () => {
    expect(ids()).toEqual([])
    expect(() => discoverCases(path.join(root, 'nope'))).toThrow(/does not exist/)
  })
})
