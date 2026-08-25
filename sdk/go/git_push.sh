#!/bin/sh
# Not applicable to this SDK — left as a stub deliberately, not deleted.
#
# openapi-generator's default git_push.sh (see git history, or any other
# generated SDK's copy) assumes sdk/go is a standalone repository it can
# `git init`/`git push` to a fresh remote. It isn't one: this module lives at
# sdk/go inside the roshansingh/programmableinbox monorepo, at module path
# github.com/roshansingh/programmableinbox/sdk/go. There is no
# `programmableinbox-go` repo to push it to.
#
# This file is listed in .openapi-generator-ignore precisely so regeneration
# can't silently restore the standalone-repo version of this script with a
# git_repo_id that no longer resolves to anything.
#
# Releases are cut by pushing a `sdk/go/vX.Y.Z` tag from the monorepo itself
# — see .github/workflows/release.yml and sdk/go/README.md. That's what
# `go get github.com/roshansingh/programmableinbox/sdk/go@vX.Y.Z` resolves
# against, per Go's convention for subdirectory modules.
echo "sdk/go/git_push.sh: not applicable — this SDK ships via git tags on the monorepo, see sdk/go/README.md" >&2
exit 1
