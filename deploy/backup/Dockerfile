# syntax=docker/dockerfile:1.6
FROM debian:bookworm-slim

ARG WALG_VERSION=v3.0.8
ARG RCLONE_VERSION=v1.66.0
ARG TARGETARCH=amd64

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates wget curl cron postgresql-client restic openssh-client unzip tini \
 && wget -q "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-ubuntu-22.04-${TARGETARCH}" \
      -O /usr/local/bin/wal-g \
 && chmod 0755 /usr/local/bin/wal-g \
 && wget -q "https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-${TARGETARCH}.zip" \
      -O /tmp/rclone.zip \
 && unzip -p /tmp/rclone.zip "rclone-${RCLONE_VERSION}-linux-${TARGETARCH}/rclone" > /usr/local/bin/rclone \
 && chmod 0755 /usr/local/bin/rclone \
 && rm -f /tmp/rclone.zip \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/log/backup

COPY scripts /scripts
RUN chmod 0755 /scripts/*.sh

COPY crontab /etc/cron.d/backup-cron
RUN chmod 0644 /etc/cron.d/backup-cron

COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
