#!/usr/bin/env node
/**
 * Read each SDK's version from its own manifest — the source of truth
 * `.github/workflows/release.yml` reads before deciding whether that
 * language publishes this round (see sdk/README.md#publishing).
 *
 * Four of the five languages carry a version field in a manifest the SDK
 * itself ships (`pyproject.toml`, `package.json`, `pom.xml`, the C#
 * `.csproj`); Go has none, so `sdk/go/VERSION` plays that role instead — see
 * the comment on `gitRepoId` in `sdk/openapi-generator-config/go.yaml`.
 *
 * Parsing is regex-based rather than a real TOML/XML parser: these are
 * generator-produced files with one field openapi-generator itself writes in
 * a fixed shape, not arbitrary input, and pulling in a parser dependency for
 * one line per file isn't worth it. Each `parse*Version` function takes raw
 * file content (not a path) so it's testable against a fixture string
 * without touching the filesystem.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '..', '..')

/** Relative to the repo root. */
export const MANIFEST_PATHS = {
  python: 'sdk/python/pyproject.toml',
  typescript: 'sdk/typescript/package.json',
  java: 'sdk/java/pom.xml',
  csharp: 'sdk/csharp/src/ProgrammableInbox.Sdk/ProgrammableInbox.Sdk.csproj',
  go: 'sdk/go/VERSION',
}

export const SDK_LANGUAGES = Object.keys(MANIFEST_PATHS)

/**
 * `pyproject.toml`'s `[project]` table has one `version = "..."` line.
 * Anchored to the start of a line so a version pinned on some dependency
 * further down (`"foo>=1.2.3"`) can't be mistaken for it.
 */
export function parsePyprojectVersion(content) {
  const match = content.match(/^version\s*=\s*"([^"]+)"/m)
  if (!match) throw new Error('no `version = "..."` line found in pyproject.toml')
  return match[1]
}

export function parsePackageJsonVersion(content) {
  const parsed = JSON.parse(content)
  if (typeof parsed.version !== 'string') throw new Error('package.json has no string "version" field')
  return parsed.version
}

/**
 * openapi-generator's Java template writes the project's own `<version>` at
 * 4-space indentation directly under `<project>`, before `<build>`/
 * `<dependencies>`. Build-plugin versions further down the same file (e.g.
 * `maven-enforcer-plugin`) are nested deeper and indented further, so
 * anchoring the indentation — rather than taking the first `<version>` tag
 * in the file — is what keeps this from picking up the wrong one.
 */
export function parsePomVersion(content) {
  const match = content.match(/^ {4}<version>([^<]+)<\/version>\s*$/m)
  if (!match) throw new Error('no top-level <version> tag found in pom.xml')
  return match[1]
}

export function parseCsprojVersion(content) {
  const match = content.match(/<Version>([^<]+)<\/Version>/)
  if (!match) throw new Error('no <Version> tag found in .csproj')
  return match[1]
}

export function parseGoVersionFile(content) {
  const version = content.trim()
  if (!version) throw new Error('sdk/go/VERSION is empty')
  return version
}

const PARSERS = {
  python: parsePyprojectVersion,
  typescript: parsePackageJsonVersion,
  java: parsePomVersion,
  csharp: parseCsprojVersion,
  go: parseGoVersionFile,
}

/** Parse a version out of raw manifest content for the given language. */
export function parseVersion(lang, content) {
  const parser = PARSERS[lang]
  if (!parser) throw new Error(`unknown SDK language: ${lang}`)
  return parser(content)
}

/** Read and parse the on-disk manifest for the given language. */
export function getManifestVersion(lang, root = ROOT) {
  const path = MANIFEST_PATHS[lang]
  if (!path) throw new Error(`unknown SDK language: ${lang}`)
  const content = readFileSync(resolve(root, path), 'utf8')
  return parseVersion(lang, content)
}
