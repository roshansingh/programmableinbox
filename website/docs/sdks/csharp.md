---
sidebar_position: 5
title: C#
---

# C# SDK

```bash
dotnet add package ProgrammableInbox.Sdk
```

```csharp
var host = Host.CreateDefaultBuilder(args)
    .ConfigureApi((context, options) =>
    {
        BearerToken token = new("sk_live_...");
        options.AddTokens(token);
    })
    .Build();

var api = host.Services.GetRequiredService<IEmailInboxesApi>();
IListEmailInboxesApiResponse response = await api.ListEmailInboxesAsync();
```

Point at a self-hosted instance by configuring the underlying `HttpClient`'s
base address inside `ConfigureApi`.

See the [API Reference](../api-reference/authentication-and-scopes) for
every available operation.
