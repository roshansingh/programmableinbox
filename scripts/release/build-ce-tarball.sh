#!/usr/bin/env bash
set -euo pipefail

# Build the Community Edition source tarball for a tagged release
# (.github/workflows/release.yml, issue #130 §1).
#
# Destructive: it runs `scripts/foss.mjs --force`, which deletes `ee/` (and
# the (ee) route groups) from the *current working tree* and renames
# instrumentation.foss.ts over instrumentation.ts — see that script's own
# header. This must only ever run against a fresh, disposable checkout of the
# tag (what the release job does), never against a developer's working copy.
#
# Usage: scripts/release/build-ce-tarball.sh <tag> [output-dir]
#   <tag>         e.g. v0.10.0 — becomes the tarball's top-level directory
#                 prefix, programmableinbox-ce-<tag>/
#   [output-dir]  where to write the .tar.gz (default: repo root)

tag="${1:?usage: build-ce-tarball.sh <tag> [output-dir]}"
out_dir="${2:-.}"

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

echo "==> Stripping commercial code (scripts/foss.mjs)"
node scripts/foss.mjs --force

echo "==> Stripping internal planning artifacts (not applicable to a self-hoster building from source)"
rm -rf docs/superpowers/specs debates tickets plans deploy

if [ -d ee ]; then
  echo "::error::ee/ still present after strip — refusing to package" >&2
  exit 1
fi

prefix="programmableinbox-ce-${tag}"
tarball="$(cd "$out_dir" && pwd)/${prefix}.tar.gz"

work_dir="$(mktemp -d)"
target="${work_dir}/${prefix}"
mkdir -p "$target"
# `cp -a . target/` copies the *contents* of the repo root into target
# (not a nested "."), including dotfiles — verified behavior, not assumed.
cp -a . "$target/"
# .git has no place in a source tarball — it's this checkout's history, not
# the release's, and roughly doubles the size for nothing a self-hoster
# building from source needs.
rm -rf "${target}/.git"

tar czf "$tarball" -C "$work_dir" "$prefix"
rm -rf "$work_dir"

echo "==> Guardrail: asserting no ee/ inside the tarball"
if tar tzf "$tarball" | grep -qE "^${prefix}/ee/"; then
  echo "::error::ee/ found inside ${tarball}" >&2
  exit 1
fi

echo "Wrote ${tarball}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "tarball=${tarball}" >>"$GITHUB_OUTPUT"
  echo "tarball_name=${prefix}.tar.gz" >>"$GITHUB_OUTPUT"
fi
