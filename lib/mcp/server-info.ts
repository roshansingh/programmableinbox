// Default import, not `import { version }`: webpack warns that named exports
// from a JSON module are going away ("only default export is available soon"),
// so the named form is a build warning today and a build error later.
import packageJson from '@/package.json'

/**
 * What `initialize` reports to a connecting MCP client.
 *
 * The two fields come from deliberately different places, which is worth
 * stating because it looks inconsistent otherwise.
 *
 * **`version` is read from package.json** rather than written here. A literal
 * would be correct exactly once — at the next release it silently reports a
 * build that is not the one running, and a version string nobody can correlate
 * with a deployed artifact is worse than no version string at all.
 *
 * **`name` is not.** `package.json#name` is still `my-v0-project` from the
 * v0.app scaffold (see the known-issues list in CLAUDE.md). Sourcing the name
 * from there would publish that to every connected client and bake it into
 * users' saved client configs — MCP has no server-rename mechanism, so it would
 * be a hard break to undo later. It stays a deliberate constant until the
 * package is renamed, at which point this can collapse to one source.
 */
export const SERVER_INFO = {
  name: 'programmableinbox',
  version: packageJson.version,
} as const
