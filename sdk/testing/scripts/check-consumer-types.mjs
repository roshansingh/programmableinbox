// Type-checks the *built* package the way a user's project would: imported by
// package name from a node_modules, under each TypeScript module-resolution
// mode, with a user's own Chainable augmentation alongside ours.
//
// Importing by relative path (as the e2e smoke tests do) skips the package's
// `exports` / `typesVersions` entirely, so a broken subpath type resolution
// passes everything else and only shows up as a red editor in someone's repo.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tsc = join(pkg, 'node_modules', '.bin', 'tsc')

const SPEC = `
import '@programmableinbox/testing/cypress/support'
import { pibxTasks } from '@programmableinbox/testing/cypress'
import { pibxFixtures, type PibxFixtures } from '@programmableinbox/testing/playwright'
import { createPibxClient, type PibxClient } from '@programmableinbox/testing'
import { test as base } from '@playwright/test'

declare global {
  namespace Cypress {
    interface Chainable {
      chatgptLogin(email: string): Chainable<void>
    }
  }
}

export const test = base.extend<PibxFixtures>(pibxFixtures)
export const tasks: typeof pibxTasks = pibxTasks
export const client: PibxClient = createPibxClient({ apiKey: 'k' })

cy.pibxOtp({ from: 'openai.com', after: () => { cy.get('button').click() } })
  .then((code: string) => cy.log(code))
cy.pibxNow().then((since: string) => cy.pibxWaitForOtp({ since, timeoutMs: 1000 }))
cy.chatgptLogin('a@b.c')
`

const MODES = {
  // What the Cypress TypeScript guide scaffolds: no module settings at all.
  node10: {},
  node16: { module: 'node16', moduleResolution: 'node16' },
  bundler: { module: 'esnext', moduleResolution: 'bundler' },
}

let failed = false
for (const [name, options] of Object.entries(MODES)) {
  const dir = mkdtempSync(join(tmpdir(), 'pibx-consumer-'))
  try {
    const nm = join(dir, 'node_modules')
    mkdirSync(join(nm, '@programmableinbox'), { recursive: true })
    mkdirSync(join(nm, '@playwright'), { recursive: true })
    mkdirSync(join(nm, '@types'), { recursive: true })
    symlinkSync(pkg, join(nm, '@programmableinbox', 'testing'))
    symlinkSync(join(pkg, 'node_modules', 'cypress'), join(nm, 'cypress'))
    symlinkSync(join(pkg, 'node_modules', '@playwright', 'test'), join(nm, '@playwright', 'test'))
    symlinkSync(join(pkg, 'node_modules', '@types', 'node'), join(nm, '@types', 'node'))
    writeFileSync(join(dir, 'spec.ts'), SPEC)
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          lib: ['es2020', 'dom'],
          types: ['cypress', 'node'],
          ...options,
        },
        files: ['spec.ts'],
      }),
    )
    try {
      execFileSync(tsc, ['-p', dir], { stdio: 'pipe' })
      console.log(`ok   ${name}`)
    } catch (e) {
      failed = true
      console.error(`FAIL ${name}\n${e.stdout?.toString() ?? e.message}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
process.exit(failed ? 1 : 0)
