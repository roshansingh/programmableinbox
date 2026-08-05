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

  it('reports the package name', () => {
    expect(SERVER_INFO.name).toBe(packageJson.name)
  })

  /**
   * Pinned deliberately, and not redundant with the assertion above.
   *
   * The two together say "the server name is `programmableinbox` **and** it is
   * sourced from package.json". Renaming the package would keep the first test
   * passing while silently renaming the MCP server — which every client
   * identifies this server by in its saved config, and which MCP has no
   * mechanism to alias or redirect. This is the test that turns that into a
   * deliberate decision instead of a side effect.
   */
  it('is named programmableinbox — renaming it breaks every saved client config', () => {
    expect(SERVER_INFO.name).toBe('programmableinbox')
  })
})
