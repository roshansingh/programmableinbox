import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')

/**
 * Files legitimately allowed to read `process.env` directly.
 *
 * Kept in step with the allowlist in `eslint.config.mjs`. Both exist on
 * purpose: the lint rule is what a developer sees in their editor, and this is
 * what CI enforces — `npm run test` is the gate that has always run, and the
 * repo already asserts structural rules this way in
 * `lib/__tests__/route-guards.test.ts`.
 */
const ALLOWLIST = [
  /^lib\/config\//,
  /^prisma\.config\.ts$/,
  /^prisma\/seed\.ts$/,
  /^next\.config\.mjs$/,
  /^eslint\.config\.mjs$/,
  /^instrumentation\.ts$/,
  /^vitest[.\w]*\.config\.ts$/,
  /^test\//,
  /(^|\/)__tests__\//,
  /^scripts\//,
  // Generated Prisma client — regenerated on every `prisma generate`, and the
  // matches there are documentation comments.
  /^lib\/generated\//,
]

/** Files whose only matches are prose in a comment. */
const COMMENT_ONLY = new Set(['lib/db.ts'])

describe('process.env is confined to lib/config', () => {
  it('has no production reads outside the allowlist', () => {
    // `--untracked` also scans new files that are not staged yet (it still
    // honours .gitignore). Without it a violation in a brand-new file is
    // invisible locally and only fails once committed, which is the wrong
    // moment to find out.
    //
    // The `*.ts` pathspecs do match nested paths: git globs with wildmatch and
    // no WM_PATHNAME, so `*` crosses `/`. Verified against a file four
    // directories deep.
    const output = execFileSync(
      'git',
      ['grep', '-l', '--untracked', '-e', 'process\\.env', '--', '*.ts', '*.tsx', '*.mjs'],
      { cwd: ROOT, encoding: 'utf8' },
    )

    const offenders = output
      .split('\n')
      .filter(Boolean)
      .filter((file) => !ALLOWLIST.some((pattern) => pattern.test(file)))
      .filter((file) => !COMMENT_ONLY.has(file))

    expect(offenders).toEqual([])
  })

  it('keeps the eslint allowlist in step with this one', () => {
    const source = readFileSync(resolve(ROOT, 'eslint.config.mjs'), 'utf8')

    // The two allowlists are written in different languages (glob vs regex),
    // so this checks the entries that matter rather than diffing them.
    for (const entry of ['lib/config/**', 'prisma.config.ts', 'prisma/seed.ts', 'test/**']) {
      expect(source).toContain(entry)
    }
    expect(source).toContain('no-restricted-syntax')
  })
})
