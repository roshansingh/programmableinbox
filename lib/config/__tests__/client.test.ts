import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { clientConfig } from '../client'

const raw = readFileSync(resolve(__dirname, '../client.ts'), 'utf8')

// Comments in this file discuss `process.env[name]` and the server-only
// modules by name, so the assertions below have to look at code, not prose.
const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('clientConfig', () => {
  it('exposes a validated apiMode', () => {
    expect(['local', 'external']).toContain(clientConfig.apiMode)
  })

  it('references NEXT_PUBLIC_ vars as static literals so Next can inline them', () => {
    // Dynamic access is not substituted into the browser bundle and silently
    // reads undefined there.
    expect(source).not.toMatch(/process\.env\[/)
    expect(source).toMatch(/process\.env\.NEXT_PUBLIC_API_MODE/)
  })

  it('reads no variable that is not NEXT_PUBLIC_', () => {
    const reads = [...source.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1])
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every((name) => name.startsWith('NEXT_PUBLIC_'))).toBe(true)
  })

  it('does not import the server-only config modules', () => {
    // Importing any of these into a client bundle fails the build, which is the
    // point of the split — but the failure would surface far from here.
    expect(source).not.toMatch(/from '\.\/(index|schema|assert|secret)'/)
    expect(source).not.toMatch(/server-only/)
  })

  it('is importable without server-only being resolvable', async () => {
    await expect(import('../client')).resolves.toHaveProperty('clientConfig')
  })
})
