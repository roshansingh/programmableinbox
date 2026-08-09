# The commercial layer

ProgrammableInbox is open core: the code in this repository is licensed under AGPL-3.0, with a
carve-out for anything under `ee/` (see the root [LICENSE](../../LICENSE) and
[`ee/README.md`](../../ee/README.md)). This doc describes the seam between the two, not the
license itself.

## The pattern: an injected, swappable provider

`lib/commercial/` defines the interfaces a commercial layer would implement, plus permissive
no-op defaults that the open-source build ships with:

| File | Role |
|---|---|
| `interfaces.ts` | `IPolicy`, `IEntitlements`, `IMetering` |
| `provider.ts` | `CommercialProvider.configure(policy, entitlements, metering)` — the injection point |
| `init.ts` | `initializeCommercial()` — reads config, wires a provider (or the OSS defaults) |
| `oss/AllowAllPolicy.ts`, `oss/EnableAllEntitlements.ts`, `oss/NoopMetering.ts` | The OSS defaults — permit everything, meter nothing |

Call sites go through `CommercialProvider`, never through a concrete implementation, so the same
code path works whether or not a commercial layer is present:

```
lib/llm/enrichment.ts → CommercialProvider.entitlements.canUse({ organizationId, feature: 'llm_enrichment' })
```

With no commercial layer configured, that call resolves to `EnableAllEntitlements`, which permits
everything. That's the entire mechanism — a self-hosted, fully open-source build has no missing
imports and no disabled code paths; it just always gets the permissive answer.

## Why `ee/`, not a separate repo

Keeping commercial code in a directory inside this repository — rather than a downstream fork
that merges from upstream, or a second repo that imports this one as a package — avoids a merge
tax that scales with how far the two codebases drift. The pattern (sometimes called an
**additive overlay**) has one invariant: commercial code only *adds* files, it never edits a file
that also exists in the open-source tree. `CommercialProvider.configure(...)` is that one edit
point, and it's already in place — a commercial layer plugs into it without touching anything
else in `lib/` or `app/`.

If you're looking for the fuller reasoning behind this choice (why not a fork, why not a separate
package, what other open-core products do here), see `reports/oss-saas-strategy.md` if it's
present in your checkout — that analysis isn't shipped as part of the public docs.

## Current state

As of this writing, the seam is built but mostly unwired: `IPolicy.check()` and
`IMetering.record()` have no production callers yet, and there's no billing code or Stripe
integration in this repository. `ENABLE_BILLING` exists as a config flag but doesn't gate any
behavior — it only selects which line gets logged at startup. Treat `lib/commercial/` as the
contract a future commercial layer will implement, not as a feature that's live today.

## Related

- [configuration.md](configuration.md) — where `ENABLE_BILLING` and other flags are validated
