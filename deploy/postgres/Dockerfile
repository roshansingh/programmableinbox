# syntax=docker/dockerfile:1.6
FROM postgres:17-bookworm

ARG WALG_VERSION=v3.0.8
ARG TARGETARCH=amd64

RUN apt-get update \
 && apt-get install -y --no-install-recommends wget ca-certificates \
 && wget -q "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-22.04-${TARGETARCH}" \
      -O /usr/local/bin/wal-g \
 && chmod 0755 /usr/local/bin/wal-g \
 && rm -rf /var/lib/apt/lists/*

COPY postgresql.conf /etc/postgresql/postgresql.conf
COPY walg-archive-wrapper.sh /usr/local/bin/walg-archive-wrapper
RUN chmod 0755 /usr/local/bin/walg-archive-wrapper

# Least-privileged role model (issue #41). The SQL is the single source of
# truth; the wrapper is invoked both by the initdb hook below and, for clusters
# that are already initialised, by deploy/scripts/pg-apply-least-privilege.sh.
COPY least-privilege-roles.sql /usr/local/share/inboxui/least-privilege-roles.sql
COPY apply-least-privilege.sh /usr/local/bin/inboxui-apply-least-privilege
# ⚠️  /docker-entrypoint-initdb.d runs ONLY on a first-time init (empty PGDATA).
#     Existing deployments must be converted explicitly — see
#     deploy/runbooks/04-postgres-role-rotation.md.
COPY initdb/10-least-privilege-roles.sh /docker-entrypoint-initdb.d/10-least-privilege-roles.sh
RUN chmod 0755 /usr/local/bin/inboxui-apply-least-privilege \
               /docker-entrypoint-initdb.d/10-least-privilege-roles.sh \
 && chmod 0644 /usr/local/share/inboxui/least-privilege-roles.sql

# docker-compose.yml passes `command: postgres -c config_file=...` so the
# custom config is loaded at startup.
CMD ["postgres"]
