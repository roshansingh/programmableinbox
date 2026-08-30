#!/usr/bin/env node
/**
 * CLI glue between `.github/workflows/release.yml`'s SDK-publish matrix and
 * the pure logic in `sdk-manifest.mjs` / `registry-status.mjs`.
 *
 * Prints `version=X.Y.Z` and (unless `--version-only`) `published=true|false`
 * to stdout, and appends the same to `$GITHUB_OUTPUT` when that env var is
 * set, so a workflow step can do:
 *
 *   - id: check
 *     run: node scripts/release/check-sdk.mjs python
 *   - if: steps.check.outputs.published == 'false'
 *     run: ...build and publish...
 *
 * "Already published" is printed, never treated as a failure — a re-run of
 * the same tag must be a clean skip (see registry-status.mjs).
 *
 *   node scripts/release/check-sdk.mjs <python|typescript|java|csharp|go> [--version-only]
 *
 * `--version-only` skips the registry lookup entirely. Go always implies it:
 * `go get` resolves versions from git tags, not an HTTP registry, so its
 * "already published?" check is a `git ls-remote --tags` the workflow runs
 * itself, not something this script can answer.
 */
import { argv, exit } from 'node:process'
import { appendFileSync } from 'node:fs'
import { getManifestVersion, SDK_LANGUAGES } from './sdk-manifest.mjs'
import { isPublished } from './registry-status.mjs'

async function main() {
  const args = argv.slice(2)
  const lang = args[0]
  const versionOnly = args.includes('--version-only') || lang === 'go'

  if (!SDK_LANGUAGES.includes(lang)) {
    console.error(`usage: check-sdk.mjs <${SDK_LANGUAGES.join('|')}> [--version-only]`)
    return 1
  }

  const version = getManifestVersion(lang)
  const lines = [`version=${version}`]

  if (!versionOnly) {
    const published = await isPublished(lang, version)
    lines.push(`published=${published}`)
  }

  for (const line of lines) console.log(line)

  const outputFile = process.env.GITHUB_OUTPUT
  if (outputFile) {
    appendFileSync(outputFile, lines.map((l) => `${l}\n`).join(''))
  }

  return 0
}

main().then(
  (code) => exit(code),
  (error) => {
    console.error(error.stack ?? String(error))
    exit(1)
  },
)
