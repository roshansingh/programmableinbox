# ee/

Reserved for commercial/enterprise code (billing, quotas, and related functionality). Nothing
here yet — the injection point it will plug into is `lib/commercial/` (see
[`docs/architecture/commercial-layer.md`](../docs/architecture/commercial-layer.md)).

Everything under this directory, if it exists, is licensed under [`ee/LICENSE`](LICENSE) rather
than the AGPL-3.0 license that covers the rest of the repository. A build with this directory
removed is a complete, functioning open-source edition.
