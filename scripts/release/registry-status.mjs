#!/usr/bin/env node
/**
 * "Is this SDK version already live on its registry?" — the check that
 * makes `.github/workflows/release.yml`'s per-language publish step
 * idempotent. A tag re-run must be a clean skip, not a failure, so every
 * function here answers a plain boolean rather than throwing on "not found".
 *
 * `fetchImpl` is threaded through every function rather than closing over
 * the global `fetch`, so `scripts/__tests__/release-registry-status.test.ts`
 * can inject a fake and assert the exact URL called — no live network calls
 * from the test suite. Go has no entry here: `go get` resolves module
 * versions from git tags, not a registry with an HTTP lookup API, so its
 * "already published?" check is a `git ls-remote --tags` done directly in
 * the workflow rather than through this module.
 */

/** The identity each language's package is looked up by. */
export const PACKAGE_IDENTITY = {
  python: { name: 'programmableinbox' },
  typescript: { name: '@programmableinbox/sdk' },
  java: { groupId: 'com.programmableinbox', artifactId: 'sdk' },
  csharp: { id: 'ProgrammableInbox.Sdk' },
}

/** PyPI's per-release JSON endpoint 404s for a version that was never uploaded. */
export async function isPyPiVersionPublished({ name }, version, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`)
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`PyPI lookup for ${name}@${version} failed: HTTP ${res.status}`)
  return true
}

/**
 * npm's registry serves a package@version document directly at this path,
 * 404ing when that exact version hasn't been published (whether or not the
 * package exists at all under other versions).
 */
export async function isNpmVersionPublished({ name }, version, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`)
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`npm lookup for ${name}@${version} failed: HTTP ${res.status}`)
  return true
}

/**
 * Maven Central has no per-artifact-version document endpoint; `solrsearch`
 * with an exact g/a/v query is the documented way to ask "does this
 * coordinate exist", returning `response.numFound` rather than a 404.
 */
export async function isMavenVersionPublished(
  { groupId, artifactId },
  version,
  { fetchImpl = fetch } = {},
) {
  const query = `g:${JSON.stringify(groupId)} AND a:${JSON.stringify(artifactId)} AND v:${JSON.stringify(version)}`
  const url = `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(query)}&core=gav&rows=1&wt=json`
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`Maven Central lookup for ${groupId}:${artifactId}:${version} failed: HTTP ${res.status}`)
  const body = await res.json()
  return (body?.response?.numFound ?? 0) > 0
}

/**
 * NuGet's flat-container index lists every published version of a package.
 * A package with zero versions published ever 404s the index itself, which
 * is "not published" exactly the same as the index existing without this
 * version in it — both collapse to `false` here.
 */
export async function isNuGetVersionPublished({ id }, version, { fetchImpl = fetch } = {}) {
  const lowerId = id.toLowerCase()
  const res = await fetchImpl(`https://api.nuget.org/v3-flatcontainer/${encodeURIComponent(lowerId)}/index.json`)
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`NuGet lookup for ${id} failed: HTTP ${res.status}`)
  const body = await res.json()
  const versions = Array.isArray(body?.versions) ? body.versions : []
  return versions.some((v) => v.toLowerCase() === version.toLowerCase())
}

const CHECKERS = {
  python: isPyPiVersionPublished,
  typescript: isNpmVersionPublished,
  java: isMavenVersionPublished,
  csharp: isNuGetVersionPublished,
}

/** Look up whether `lang`'s package is already published at `version`. */
export async function isPublished(lang, version, opts = {}) {
  const checker = CHECKERS[lang]
  if (!checker) throw new Error(`no registry checker for SDK language: ${lang}`)
  return checker(PACKAGE_IDENTITY[lang], version, opts)
}
