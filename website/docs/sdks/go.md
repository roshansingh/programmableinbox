---
sidebar_position: 3
title: Go
---

# Go SDK

```bash
go get github.com/roshansingh/programmableinbox/sdk/go
```

```go
configuration := programmableinbox.NewConfiguration()
client := programmableinbox.NewAPIClient(configuration)

ctx := context.WithValue(
    context.Background(),
    programmableinbox.ContextAccessToken,
    "sk_live_...",
)

inboxes, _, err := client.EmailInboxesAPI.ListEmailInboxes(ctx).Execute()
```

Point at a self-hosted instance by setting `configuration.Servers` to your
own host before calling `NewAPIClient`.

See the [API Reference](../api-reference/authentication-and-scopes) for
every available operation.
