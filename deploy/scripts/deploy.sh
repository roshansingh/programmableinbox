#!/usr/bin/env bash
# Server-side deploy hook. Called from CI over SSH:
#   ssh deploy@host '/srv/inboxui/deploy.sh <git-sha>'
set -euo pipefail

TAG="${1:?usage: $0 <image-tag>}"
COMPOSE_DIR=/srv/inboxui

cd "$COMPOSE_DIR"

PREVIOUS_TAG=$(docker inspect --format '{{ index .Config.Labels "image.tag" }}' inboxui-app-1 2>/dev/null || true)
echo "Previous tag: ${PREVIOUS_TAG:-unknown}"
echo "Rolling to:   ${TAG}"

export IMAGE_TAG="$TAG"
docker compose pull app migrate

docker compose run --rm migrate

docker compose up -d --no-deps app caddy

echo "Waiting for app to become healthy..."
for i in $(seq 1 30); do
  status=$(docker inspect --format '{{ .State.Health.Status }}' inboxui-app-1 2>/dev/null || echo starting)
  if [[ "$status" == "healthy" ]]; then
    echo "App healthy after ${i}0s"
    break
  fi
  sleep 10
done

if [[ "$(docker inspect --format '{{ .State.Health.Status }}' inboxui-app-1)" != "healthy" ]]; then
  echo "App did not become healthy. Inspect: docker compose logs --tail=100 app"
  exit 1
fi

docker image prune -f >/dev/null
echo "Deploy complete: $TAG"
