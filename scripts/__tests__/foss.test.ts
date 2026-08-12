import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { COMMERCIAL_PATHS } from '../foss.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

function read(path: string) {
  return readFileSync(resolve(ROOT, path), 'utf8')
}

/**
 * True once `scripts/foss.mjs` has run — the FOSS entrypoint has been renamed
 * over the default one and `ee/` is gone.
 *
 * These tests describe the *relationship* between the two entrypoints, so in a
 * stripped tree there is nothing left to compare and they skip rather than
 * fail. The CI `foss` job runs the full suite after stripping, and a hard
 * failure there would report "the OSS build is broken" for a file that did its
 * job correctly.
 */
const ALREADY_STRIPPED = !existsSync(resolve(ROOT, 'instrumentation.foss.ts'))

/** Every module specifier the file dynamically imports, in source order. */
function dynamicImports(source: string): string[] {
  return [...source.matchAll(/await import\(\s*'([^']+)'\s*\)/g)].map((m) => m[1])
}

describe.skipIf(ALREADY_STRIPPED)('FOSS entrypoint', () => {
  // Read lazily. `describe.skipIf` still evaluates this callback to collect
  // tests, so a top-level read would throw ENOENT in a stripped tree — during
  // collection, where the skip cannot help.
  const main = () => read('instrumentation.ts')
  const foss = () => read('instrumentation.foss.ts')

  it('imports the commercial and observability init in the default entrypoint', () => {
    expect(dynamicImports(main())).toContain('@/ee/init')
    expect(dynamicImports(main())).toContain('@/ee/observability/init')
  })

  it('does not import anything commercial in the FOSS entrypoint', () => {
    const specifiers = dynamicImports(foss())

    expect(specifiers).not.toContain('@/ee/init')
    expect(specifiers).not.toContain('@/ee/observability/init')
    for (const path of COMMERCIAL_PATHS) {
      expect(specifiers.some((s) => s.includes(`/${path}/`))).toBe(false)
    }
  })

  /**
   * The drift guard, and the reason this file exists.
   *
   * A second entrypoint is a maintenance hazard: a boot step added to one and
   * not the other produces a FOSS build that silently skips it — the webhook
   * worker never starting, say, which no test would otherwise catch because the
   * FOSS build is not what the suite runs against. Comparing the import lists
   * makes that a failure here instead.
   *
   * Generalized to a prefix check rather than one literal string: any dynamic
   * import under @/ee/ is a commercial boot step, and this guard exists
   * precisely so adding a second one (as observability did) can't silently
   * land in only one of the two entrypoints.
   */
  it('is the default entrypoint minus every @/ee/ import', () => {
    const expected = dynamicImports(main()).filter((s) => !s.startsWith('@/ee/'))

    expect(dynamicImports(foss())).toEqual(expected)
  })

  it('guards the same Node-only runtime branch', () => {
    expect(foss()).toContain("process.env.NEXT_RUNTIME === 'nodejs'")
  })

  it('exports register, which is the hook Next actually calls', () => {
    expect(foss()).toMatch(/export async function register\s*\(/)
  })
})

describe.skipIf(ALREADY_STRIPPED)('commercial path manifest', () => {
  it('names paths that exist, so the strip script cannot silently no-op', () => {
    for (const path of COMMERCIAL_PATHS) {
      expect(existsSync(resolve(ROOT, path)), `${path} should exist`).toBe(true)
    }
  })

  /**
   * The failure mode this prevents is Cal.com's: a third commercial directory
   * existed for years outside the paths its own LICENSE named, so by the plain
   * text of that file it was AGPL. Enumerated carve-outs need a lint, not care.
   *
   * Skipped until a LICENSE lands — the repo has none yet, which is its own
   * blocker (it is currently all-rights-reserved and unusable by anyone).
   */
  it.skipIf(!existsSync(resolve(ROOT, 'LICENSE')))(
    'names every path the LICENSE carve-out delegates',
    () => {
      const licence = read('LICENSE')
      for (const path of COMMERCIAL_PATHS) {
        expect(licence).toContain(`"${path}/"`)
      }
    },
  )
})
