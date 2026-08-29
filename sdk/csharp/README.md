# ProgrammableInbox C# SDK

[ProgrammableInbox](https://www.programmableinbox.com/) is a secondary inbox built for
developers. Spin up a programmable email address in seconds, and it receives, categorizes, and
extracts every message that arrives — grab a one-time code over the API, route mail with a rule,
or read it in the dashboard. This is a typed client for its REST API, targeting `net8.0`.

## Install

```bash
dotnet add package ProgrammableInbox.Sdk
```

## Quick start

This generator emits a dependency-injection-based client rather than a plain constructor — the API is resolved from an `IHost`, not `new`'d directly.

```csharp
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using ProgrammableInbox.Sdk.Api;
using ProgrammableInbox.Sdk.Client;
using ProgrammableInbox.Sdk.Extensions;

var host = Host.CreateDefaultBuilder(args)
    .ConfigureApi((context, options) =>
    {
        BearerToken token = new("sk_live_...");
        options.AddTokens(token);
    })
    .Build();

var api = host.Services.GetRequiredService<IEmailInboxesApi>();
IListEmailInboxesApiResponse response = await api.ListEmailInboxesAsync();
ProgrammableInbox.Sdk.Model.ListEmailInboxes200Response? inboxes = response.Ok();
Console.WriteLine(inboxes?.Data);
```

The default base URL is `https://app.programmableinbox.com`. To point at a local dev server instead, configure the HTTP client explicitly inside `ConfigureApi`:

```csharp
options.AddApiHttpClients(client => client.BaseAddress = new Uri("http://localhost:4000"));
```

## Links

- [ProgrammableInbox](https://www.programmableinbox.com/)
- [API docs](https://app.programmableinbox.com/api-docs)
- [Source](https://github.com/roshansingh/programmableinbox)
