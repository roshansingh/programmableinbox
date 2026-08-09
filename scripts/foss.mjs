#!/usr/bin/env node
/**
 * Produce the FOSS tree: delete every commercial path, then swap in the
 * entrypoint that does not import them.
 *
 * **Destructive and irreversible in the working tree.** Intended for CI and for
 * building a release artifact, both of which run against a fresh checkout. It
 * refuses to run on a dirty tree unless `--force` is passed, so a local
 * invocation cannot eat uncommitted work.
 *
 * Why this exists at all: the licence carve-out in LICENSE says the commercial
 * directories are separately licensed *"if that directory exists"*, and that
 * clause is only honest if a build without them is a real, tested thing. CI
 * runs this on every PR and then runs the suite — which is what stops the OSS
 * edition quietly rotting into a fiction, the failure mode Rocket.Chat hit by
 * shipping the carve-out without ever building the stripped tree.
 *
 *   node scripts/foss.mjs [--force] [--check]
 *
 *   --force  proceed even if the git working tree is dirty
 *   --check  report what would be removed and exit 0, changing nothing
 */
import { execSync } from 'node:child_process'
import { existsSync, renameSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { argv } from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')

/**
 * Commercial paths, and the single source of truth for the licence carve-out.
 * Keep in step with the paths named in LICENSE — `scripts/__tests__/foss.test.ts`
 * fails if they drift, which is the check Cal.com lacked when a third `ee`
 * directory sat outside its own LICENSE for years.
 */
export const COMMERCIAL_PATHS = ['ee']

/** Swapped over their non-FOSS counterparts, in order. */
const ENTRYPOINT_SWAPS = [['instrumentation.foss.ts', 'instrumentation.ts']]

function strip({ check, force }) {
  if (!check && !force) {
    const dirty = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).trim()
    if (dirty) {
      console.error(
        'refusing to strip a dirty working tree — commit first, or pass --force.\n' +
          'this deletes files and does not put them back.',
      )
      return 1
    }
  }

  const present = COMMERCIAL_PATHS.filter((p) => existsSync(resolve(ROOT, p)))
  const swaps = ENTRYPOINT_SWAPS.filter(([from]) => existsSync(resolve(ROOT, from)))

  if (check) {
    console.log('would remove:', present.length ? present.join(', ') : '(nothing)')
    for (const [from, to] of swaps) console.log(`would swap:   ${from} -> ${to}`)
    return 0
  }

  for (const path of present) {
    rmSync(resolve(ROOT, path), { recursive: true, force: true })
    console.log(`removed ${path}`)
  }

  for (const [from, to] of swaps) {
    renameSync(resolve(ROOT, from), resolve(ROOT, to))
    console.log(`swapped ${from} -> ${to}`)
  }

  console.log('\nFOSS tree ready. Every plan limit is now unlimited by construction.')
  return 0
}

// Only strip when run as a CLI. `scripts/__tests__/foss.test.ts` imports
// COMMERCIAL_PATHS from this file to assert the manifest matches reality, and
// an unguarded top-level body would delete `ee/` the moment the suite loaded it.
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(argv.slice(2))
  process.exit(strip({ check: args.has('--check'), force: args.has('--force') }))
}
