import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT } from '../release/sdk-manifest.mjs'

const workflow = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf8')

/** The languages the sdk-publish job actually runs, from its `matrix.lang` line. */
const matrixLangs = (() => {
  const match = workflow.match(/^\s*lang:\s*\[([^\]]+)\]/m)
  if (!match) throw new Error('could not find `lang: [...]` in release.yml')
  return match[1].split(',').map((l) => l.trim())
})()

describe('release.yml sdk-publish matrix', () => {
  it('includes the test-helpers package', () => {
    expect(matrixLangs).toContain('testing')
  })

  // The "Record status for the release summary" step reads the outcome of
  // `steps[format('publish-{0}', matrix.lang)]`. A language whose publish step
  // has a different id yields an empty outcome there, and the summary reports
  // a failed publish as a success — so the id is a contract, not a label.
  it.each(matrixLangs)('has a publish-%s step the release summary can find', (lang) => {
    expect(workflow).toMatch(new RegExp(`^\\s*id:\\s*publish-${lang}\\s*$`, 'm'))
  })

  it('publishes the test-helpers package from sdk/testing, with OIDC and no token', () => {
    const start = workflow.indexOf('id: publish-testing')
    expect(start).toBeGreaterThan(-1)
    // The step block ends at the next `- name:` / `- uses:` list item.
    const rest = workflow.slice(start)
    const end = rest.search(/\n\s*- (name|uses):/)
    const step = rest.slice(0, end === -1 ? undefined : end)
    expect(step).toContain('working-directory: sdk/testing')
    expect(step).toContain('npm publish --access public')
    expect(step).toContain("env.DRY_RUN == 'false'")
    expect(step).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN/)
  })

  it('installs sdk/testing without lifecycle scripts, so CI does not download the Cypress binary', () => {
    // Comment lines may sit between `working-directory:` and `run:`.
    expect(workflow).toMatch(
      /working-directory: sdk\/testing\s*\n(?:\s*#[^\n]*\n)*\s*run: \|\s*\n\s*npm ci --ignore-scripts/,
    )
  })

  it('runs the consumer type check before publishing', () => {
    expect(workflow).toContain('npm run test:types')
  })
})
