# ee/

Commercial/enterprise code: the DB-backed plan engine (`DbPlanResolver`, `PostgresQuota`) that
implements the interfaces defined in `lib/commercial/`. See
[`docs/architecture/commercial-layer.md`](../docs/architecture/commercial-layer.md) for how the
two fit together.

Everything under this directory is licensed under [`ee/LICENSE`](LICENSE) rather than the
AGPL-3.0 license that covers the rest of the repository. A build with this directory removed is
a complete, functioning open-source edition — every organization simply resolves to an unlimited
plan.
