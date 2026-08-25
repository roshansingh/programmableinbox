# ProgrammableInbox Go SDK

Generated from `lib/openapi/email-inboxes.ts`. Regenerate with `npm run sdk:generate` from the repo root — do not hand-edit anything else in this directory.

This module lives at `sdk/go` inside the `roshansingh/programmableinbox` monorepo rather than in a
standalone repo, so its version isn't a field in a manifest like the other four SDKs — it's tracked
in [`VERSION`](VERSION), and released as a `sdk/go/vX.Y.Z` git tag on the monorepo, Go's native
convention for a subdirectory module. See `.github/workflows/release.yml`.

## Install

```bash
go get github.com/roshansingh/programmableinbox/sdk/go
```

Published via the tag-triggered release pipeline (`.github/workflows/release.yml`), gated on a
maintainer bumping [`VERSION`](VERSION) — not yet released as of this writing. Until a
`sdk/go/vX.Y.Z` tag exists, `go get` has nothing to resolve; use a `replace` directive in your own
`go.mod` pointing at a local checkout of this repo's `sdk/go` directory instead.

## Quick start

```go
package main

import (
	"context"
	"fmt"

	programmableinbox "github.com/roshansingh/programmableinbox/sdk/go"
)

func main() {
	configuration := programmableinbox.NewConfiguration()
	client := programmableinbox.NewAPIClient(configuration)
	ctx := context.WithValue(context.Background(), programmableinbox.ContextAccessToken, "sk_live_...")

	inboxes, _, err := client.EmailInboxesAPI.ListEmailInboxes(ctx).Execute()
	if err != nil {
		panic(err)
	}
	fmt.Println(inboxes.Data)
}
```

The default host is `https://app.programmableinbox.com`; call `configuration.Servers[0] = programmableinbox.ServerConfiguration{URL: "http://localhost:4000"}` to point at a local dev server instead.
