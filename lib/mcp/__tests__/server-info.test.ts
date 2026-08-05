import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SERVER_INFO } from '../server-info'

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'),
) as { name: string; version: string }

describe('SERVER_INFO', () => {
  it('reports the running package version, not a literal that drifts at the next release', () => {
    expect(SERVER_INFO.version).toBe(packageJson.version)
  })

  it('does not report the package name', () => {
    // package.json#name is still the v0.app scaffold's `my-v0-project`. Naming
    // the MCP server from it would publish that to every client and into their
    // saved configs, and MCP has no rename mechanism to walk it back.
    expect(SERVER_INFO.name).toBe('programmableinbox')
    expect(SERVER_INFO.name).not.toBe(packageJson.name)
  })
})
