# ProgrammableInbox Go SDK

Generated from `lib/openapi/email-inboxes.ts`. Regenerate with `npm run sdk:generate` from the repo root — do not hand-edit anything else in this directory.

## Install

```bash
go get github.com/roshansingh/programmableinbox-go
```

(Not yet published — see [issue #124](https://github.com/roshansingh/programmableinbox/issues/124). Until then, use a `replace` directive in your own `go.mod` pointing at a local checkout of this repo's `sdk/go` directory.)

## Quick start

```go
package main

import (
	"context"
	"fmt"

	programmableinbox "github.com/roshansingh/programmableinbox-go"
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
