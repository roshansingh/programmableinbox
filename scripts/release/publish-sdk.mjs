#!/usr/bin/env node
/**
 * Build and publish the Python or TypeScript SDK by hand — the same
 * "is this version already live?" gate and the same registry/build commands
 * `.github/workflows/release.yml`'s sdk-publish matrix uses (via
 * `sdk-manifest.mjs` / `registry-status.mjs`), so a manual run and the CI
 * job can never quietly disagree about whether a version is out.
 *
 * This is a companion to the tag-triggered pipeline, not a replacement: use
 * it when you want to publish a version outside of cutting an app release —
 * a Python-only doc fix, say — or to rehearse (`--dry-run`) before trusting
 * a real tag to do it for you.
 *
 * Usage:
 *   node scripts/release/publish-sdk.mjs <python|typescript> [--dry-run] [--force] [--otp=123456]
 *
 *   --dry-run  build and verify the package, print what would be published,
 *              but never upload. Never requires credentials.
 *   --force    skip the "already published?" registry check and build/attempt
 *              to publish regardless. The registry itself still rejects a
 *              duplicate version — this only skips OUR check, it can't make
 *              PyPI/npm accept a re-upload. Useful for rehearsing a build
 *              against a version that happens to already be live.
 *   --otp      typescript only. npm requires either this or a 2FA-bypass
 *              token to publish (see NPM_TOKEN below) — without either, a
 *              non-token publish 403s rather than reliably prompting, since
 *              OTP prompting depends on npm detecting an interactive TTY,
 *              which a wrapped child_process call can't guarantee. Get the
 *              6-digit code from your authenticator right before running
 *              this — it's time-limited, so generate it just-in-time, not
 *              ahead of time.
 *
 * Credentials (only read for a real, non-dry-run publish):
 *   python:     PYPI_API_TOKEN   — if set, used as the twine token
 *                                  (TWINE_USERNAME=__token__). If unset,
 *                                  twine falls back to its own config
 *                                  (~/.pypirc) or an interactive prompt —
 *                                  the normal flow for a maintainer who's
 *                                  already set up twine locally.
 *   typescript: NPM_TOKEN        — if set, used as a scoped, temporary
 *                                  npm auth token (never written to a
 *                                  persistent .npmrc). If unset, `npm
 *                                  publish` runs as-is, relying on
 *                                  whatever `npm login` session already
 *                                  exists locally.
 *
 * Deliberately does NOT install build tooling (pip's `build`/`twine`, npm
 * deps) — that's for the caller to have ready, same as CI's separate
 * actions/setup-python + `pip install` step before this script's logic
 * would run there. Assumes it's invoked from the repo root.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { argv, env, exit } from 'node:process'
import { fileURLToPath } from 'node:url'
import { getManifestVersion, ROOT } from './sdk-manifest.mjs'
import { isPublished, PACKAGE_IDENTITY } from './registry-status.mjs'

const SUPPORTED_LANGUAGES = ['python', 'typescript']

/**
 * Pure decision logic, kept separate from the shelling-out below so it's
 * testable without invoking python/npm. Mirrors the branching the CI
 * workflow expresses via `if:` conditions on its steps.
 */
export function resolveAction({ published, force, dryRun }) {
  if (published && !force) return 'skip'
  if (dryRun) return 'dry-run'
  return 'publish'
}

/**
 * The npm auth line, written to a throwaway config file rather than the
 * project's own `.npmrc` — `npm publish --userconfig <file>` reads it
 * without ever persisting the token to disk beyond this run.
 */
export function npmAuthConfig(token) {
  return `//registry.npmjs.org/:_authToken=${token}\n`
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit', cwd: ROOT, ...options })
}

function publishPython({ version, action }) {
  console.log(`==> Building Python SDK (sdk/python) v${version}`)
  run(env.PYTHON_BIN ?? 'python3', ['-m', 'build', 'sdk/python'])
  run('twine', ['check', ...['sdk/python/dist/*.tar.gz', 'sdk/python/dist/*.whl']])

  if (action === 'dry-run') {
    console.log(`==> Dry run: would publish programmableinbox v${version} to PyPI`)
    return
  }

  console.log('==> Publishing to PyPI')
  const publishEnv = { ...env }
  if (env.PYPI_API_TOKEN) {
    publishEnv.TWINE_USERNAME = '__token__'
    publishEnv.TWINE_PASSWORD = env.PYPI_API_TOKEN
  }
  run('twine', ['upload', ...['sdk/python/dist/*.tar.gz', 'sdk/python/dist/*.whl']], { env: publishEnv })
}

function publishTypescript({ version, action, otp }) {
  const pkgDir = resolve(ROOT, 'sdk/typescript')
  console.log(`==> Building TypeScript SDK (sdk/typescript) v${version}`)
  run('npm', ['ci'], { cwd: pkgDir })
  run('npm', ['run', 'build'], { cwd: pkgDir })
  run('npm', ['pack', '--dry-run'], { cwd: pkgDir })

  if (action === 'dry-run') {
    console.log(`==> Dry run: would publish ${PACKAGE_IDENTITY.typescript.name}@${version} to npm`)
    return
  }

  console.log('==> Publishing to npm')
  // --access public because @programmableinbox is a scoped name, which npm
  // defaults to restricted unless told otherwise.
  const publishArgs = ['publish', '--access', 'public']
  if (otp) publishArgs.push('--otp', otp)

  if (!env.NPM_TOKEN) {
    // No token supplied — publish as-is, trusting an existing `npm login`
    // session (plus --otp above, if you passed one).
    run('npm', publishArgs, { cwd: pkgDir })
    return
  }

  const configDir = mkdtempSync(join(tmpdir(), 'pibx-npm-publish-'))
  const configFile = join(configDir, '.npmrc')
  try {
    writeFileSync(configFile, npmAuthConfig(env.NPM_TOKEN))
    run('npm', [...publishArgs, '--userconfig', configFile], { cwd: pkgDir })
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
}

const PUBLISHERS = { python: publishPython, typescript: publishTypescript }

async function main() {
  const args = argv.slice(2)
  const lang = args[0]
  const dryRun = args.includes('--dry-run')
  const force = args.includes('--force')
  const otpArg = args.find((a) => a.startsWith('--otp='))
  const otp = otpArg ? otpArg.slice('--otp='.length) : undefined

  if (!SUPPORTED_LANGUAGES.includes(lang)) {
    console.error(`usage: publish-sdk.mjs <${SUPPORTED_LANGUAGES.join('|')}> [--dry-run] [--force] [--otp=123456]`)
    return 1
  }

  const version = getManifestVersion(lang)
  const published = force ? false : await isPublished(lang, version)
  const action = resolveAction({ published, force, dryRun })

  if (action === 'skip') {
    console.log(`${lang} v${version} is already published — nothing to do. Pass --force to rebuild anyway.`)
    return 0
  }

  PUBLISHERS[lang]({ version, action, otp })

  if (action === 'publish') console.log(`==> Published ${lang} v${version}`)
  return 0
}

// Only run when invoked as a CLI script. `scripts/__tests__/release-publish-sdk.test.ts`
// imports resolveAction/npmAuthConfig from this file, and an unguarded
// top-level main() would call process.exit() the moment the test file
// imports it — which doesn't fail the test, it kills the whole worker.
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => exit(code),
    (error) => {
      console.error(error.stack ?? String(error))
      exit(1)
    },
  )
}
