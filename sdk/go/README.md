# ProgrammableInbox Go SDK

[ProgrammableInbox](https://www.programmableinbox.com/) is a secondary inbox built for
developers. Spin up a programmable email address in seconds, and it receives, categorizes, and
extracts every message that arrives — grab a one-time code over the API, route mail with a rule,
or read it in the dashboard. This is a typed client for its REST API.

## Install

```bash
go get github.com/roshansingh/programmableinbox/sdk/go
```

This module lives at `sdk/go` inside the `roshansingh/programmableinbox` monorepo, which is why
the import path has that extra path segment — it's versioned via `sdk/go/vX.Y.Z` git tags on that
repo rather than a standalone module.

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

## Links

- [ProgrammableInbox](https://www.programmableinbox.com/)
- [API docs](https://app.programmableinbox.com/api-docs)
- [Source](https://github.com/roshansingh/programmableinbox)
