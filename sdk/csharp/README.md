# ProgrammableInbox C# SDK

Generated from `lib/openapi/email-inboxes.ts`, targeting `net8.0`. Regenerate with `npm run sdk:generate` from the repo root — do not hand-edit anything else in this directory.

## Install

Not yet published to NuGet. The release pipeline that publishes this now exists — see
[`sdk/README.md`](../README.md#publishing) — but publishing is gated on a maintainer bumping the
version in the `.csproj` and on NuGet registry provisioning, tracked in
[issue #130](https://github.com/roshansingh/programmableinbox/issues/130). Until then, from a
checkout, reference `src/ProgrammableInbox.Sdk/ProgrammableInbox.Sdk.csproj` directly from your own
project (`dotnet add reference`).

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
