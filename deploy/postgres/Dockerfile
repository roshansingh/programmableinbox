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

# docker-compose.yml passes `command: postgres -c config_file=...` so the
# custom config is loaded at startup.
CMD ["postgres"]
