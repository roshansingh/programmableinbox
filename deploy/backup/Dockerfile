# syntax=docker/dockerfile:1.6
FROM debian:bookworm-slim

ARG WALG_VERSION=v3.0.8
ARG TARGETARCH=amd64

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates wget curl cron postgresql-client restic tini \
 && wget -q "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-22.04-${TARGETARCH}" \
      -O /usr/local/bin/wal-g \
 && chmod 0755 /usr/local/bin/wal-g \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/log/backup

COPY scripts /scripts
RUN chmod 0755 /scripts/*.sh

COPY crontab /etc/cron.d/backup-cron
RUN chmod 0644 /etc/cron.d/backup-cron

COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
