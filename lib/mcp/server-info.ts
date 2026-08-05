// Default import, not `import { name }` / `import { version }`: webpack warns
// that named exports from a JSON module are going away ("only default export is
// available soon"), so the named form is a build warning today and a build
// error later.
import packageJson from '@/package.json'

/**
 * What `initialize` reports to a connecting MCP client.
 *
 * Both fields come from package.json rather than being written here. A literal
 * would be correct exactly once — at the next release it reports a build that
 * is not the one running, and a version string nobody can correlate with a
 * deployed artifact is worse than no version string at all.
 *
 * `name` was briefly a hand-written constant, because `package.json#name` was
 * still `my-v0-project` from the v0.app scaffold and publishing *that* to every
 * connected client would have baked it into users' saved configs — MCP has no
 * server-rename mechanism, so it would have been a hard break to undo. The
 * package has since been renamed to `programmableinbox`, so the two sources
 * agree and there is no longer a reason to keep a second copy of the name.
 *
 * The name is part of the client-facing contract: users identify this server by
 * it in their configs. Renaming the package again renames the server, which is
 * a breaking change for every existing client — `__tests__/server-info.test.ts`
 * pins the current value so that consequence is a deliberate decision rather
 * than a side effect of tidying package.json.
 */
export const SERVER_INFO = {
  name: packageJson.name,
  version: packageJson.version,
} as const
