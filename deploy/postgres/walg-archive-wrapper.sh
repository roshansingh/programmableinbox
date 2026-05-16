#!/usr/bin/env bash
# Archive command wrapper. WAL-G's `wal-push` has internal retries; we exit
# non-zero only on persistent failure so Postgres applies WAL backpressure
# rather than silently losing segments. The postgres process inherits the
# container env, so WAL-G's AWS_* / WALG_* settings are already present.
set -euo pipefail
exec /usr/local/bin/wal-g wal-push "${1:?usage: $0 <wal-path>}"
