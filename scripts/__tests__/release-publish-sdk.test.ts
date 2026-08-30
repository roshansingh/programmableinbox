import { describe, it, expect } from 'vitest'
import { resolveAction, npmAuthConfig } from '../release/publish-sdk.mjs'

describe('resolveAction', () => {
  it('skips when already published and not forced', () => {
    expect(resolveAction({ published: true, force: false, dryRun: false })).toBe('skip')
    expect(resolveAction({ published: true, force: false, dryRun: true })).toBe('skip')
  })

  it('force overrides an already-published skip', () => {
    expect(resolveAction({ published: true, force: true, dryRun: false })).toBe('publish')
    expect(resolveAction({ published: true, force: true, dryRun: true })).toBe('dry-run')
  })

  it('dry-run wins over a real publish when not already published', () => {
    expect(resolveAction({ published: false, force: false, dryRun: true })).toBe('dry-run')
  })

  it('publishes when not published, not forced, not a dry run', () => {
    expect(resolveAction({ published: false, force: false, dryRun: false })).toBe('publish')
  })
})

describe('npmAuthConfig', () => {
  it('writes a registry-scoped auth token line', () => {
    expect(npmAuthConfig('npm_abc123')).toBe('//registry.npmjs.org/:_authToken=npm_abc123\n')
  })
})
