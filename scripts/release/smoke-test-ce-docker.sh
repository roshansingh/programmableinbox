#!/usr/bin/env bash
set -euo pipefail

# Smoke-tests a released Community Edition Docker image end-to-end, using the
# exact `docker-compose.yml` at the repo root that a self-hoster runs (see
# that file's own header). Nothing here talks to the app source tree — only
# to the pulled image — so this validates the actual published artifact, not
# "does main build."
#
# .github/workflows/release.yml's `ce-docker` job only checks that `ee/` is
# absent from the built image (a filesystem guardrail). It never boots the
# image against a real Postgres/Redis and exercises the app, so a release
# could pass CI and still be broken at startup (a bad migration, a
# misconfigured env var, assertConfig() throwing) for every self-hoster who
# then pulls it. This script is that missing check, meant to be run locally
# first and later wired into release.yml as a job gating the GitHub Release.
#
# Deliberately does NOT assume `main`'s current API contract. A released tag
# lags main — verified against v0.1.2, the last tag as of this writing: it
# predates the httpOnly-session-cookie migration entirely, still returns a
# Bearer token in the register/login response body, has no
# /api/app/auth/logout route at all, and returns 201 (not 200) from create-
# inbox. Auth mode is therefore detected from the response (a `data.token` ->
# Bearer header; its absence -> the cookie jar curl already populated from
# Set-Cookie) and status checks accept any 2xx rather than one hardcoded code,
# so this keeps working as the released contract evolves across tags instead
# of needing an edit alongside every release.
#
# What it does:
#   1. pull the image (IMAGE_TAG, default: latest)
#   2. docker compose up against a throwaway Postgres + Redis
#   3. wait for /api/healthz to report healthy
#   4. exercise the golden path over HTTP: register -> login -> /auth/me ->
#      create inbox -> list inboxes (assert it's there) -> best-effort logout
#   5. tear everything down (unless --keep)
#
# Usage:
#   scripts/release/smoke-test-ce-docker.sh [image-tag] [--keep]
#
#   [image-tag]  IMAGE_TAG to pull, e.g. v0.11.0 (default: latest)
#   --keep       leave the containers/volumes/temp files running after a
#                failure (or success) for manual inspection; you tear down
#                yourself with the command this prints.
#
# Requires: docker (with the `compose` plugin), curl, jq, openssl.

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

IMAGE_TAG="latest"
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    *) IMAGE_TAG="$arg" ;;
  esac
done

APP_PORT="${APP_PORT:-4089}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-120}"
PROJECT="pibx-smoke-$$"
WORK_DIR="$(mktemp -d)"
ENV_FILE="${WORK_DIR}/.env"
COOKIE_JAR="${WORK_DIR}/cookies.txt"
BASE_URL="http://localhost:${APP_PORT}"
TEST_DOMAIN="smoketest.invalid"
TEST_EMAIL="smoke+$$@example.com"
TEST_PASSWORD="Sm0keTest-$$-$(date +%s)"

compose() {
  docker compose -f docker-compose.yml -p "$PROJECT" --env-file "$ENV_FILE" "$@"
}

log() { echo "==> $*"; }
fail() {
  echo "FAILED: $*" >&2
  echo "---- app logs ----" >&2
  compose logs app 2>&1 | tail -n 100 >&2 || true
  exit 1
}

for bin in docker curl jq openssl; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "missing required tool: $bin" >&2
    exit 1
  }
done
docker compose version >/dev/null 2>&1 || {
  echo "docker compose (v2 plugin) is required" >&2
  exit 1
}

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo "==> --keep set, leaving containers up. Tear down with:"
    echo "    docker compose -f docker-compose.yml -p ${PROJECT} --env-file \"${ENV_FILE}\" down -v --remove-orphans"
    echo "    rm -rf \"${WORK_DIR}\""
    return
  fi
  log "Tearing down"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

cat >"$ENV_FILE" <<EOF
IMAGE_TAG=${IMAGE_TAG}
APP_PORT=${APP_PORT}
POSTGRES_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -base64 32)
WEBHOOK_SECRET=$(openssl rand -hex 16)
AUTH_RESEND_API_KEY=re_placeholder
EMAIL_INBOX_DOMAINS=${TEST_DOMAIN}
EOF

log "Pulling ghcr.io/roshansingh/programmableinbox-ce:${IMAGE_TAG}"
compose pull

log "Starting Postgres, Redis, and the app (runs migrate deploy, then boots)"
compose up -d

log "Waiting for ${BASE_URL}/api/healthz (timeout ${TIMEOUT_SECONDS}s)"
deadline=$((SECONDS + TIMEOUT_SECONDS))
until curl -sf -o /dev/null "${BASE_URL}/api/healthz"; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    fail "app never became healthy within ${TIMEOUT_SECONDS}s"
  fi
  sleep 2
done
health_status="$(curl -s "${BASE_URL}/api/healthz" | jq -r '.data.status')"
[ "$health_status" = "ok" ] || fail "healthz reported status=${health_status}, expected ok"
log "Healthy (status=ok)"

# Auth header is populated once a request returns a Bearer token; empty
# otherwise, in which case the cookie jar (populated automatically from
# Set-Cookie by every curl call below) carries the session instead.
AUTH_HEADER=""

curl_json() {
  # curl_json <method> <path> [json-body]
  local method="$1" path="$2" body="${3:-}"
  local -a extra_headers=()
  [ -n "$AUTH_HEADER" ] && extra_headers=(-H "Authorization: Bearer ${AUTH_HEADER}")
  # Bash 3.2 (macOS's default /bin/bash) treats expanding a declared-but-empty
  # array under `set -u` as an unbound-variable error. `${arr[@]+"${arr[@]}"}`
  # is the portable idiom: it expands to nothing when the array has zero
  # elements instead of triggering that check.
  if [ -n "$body" ]; then
    curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" "${BASE_URL}${path}" \
      ${extra_headers[@]+"${extra_headers[@]}"} -H 'Content-Type: application/json' -d "$body" -w '\n%{http_code}'
  else
    curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" "${BASE_URL}${path}" \
      ${extra_headers[@]+"${extra_headers[@]}"} -w '\n%{http_code}'
  fi
}

expect_2xx() {
  # expect_2xx <response> <what> -> prints body, fails unless HTTP 2xx
  local response="$1" what="$2"
  local code body
  code="$(tail -n1 <<<"$response")"
  body="$(sed '$d' <<<"$response")"
  case "$code" in
    2??) ;;
    *)
      echo "$body" >&2
      fail "$what: expected a 2xx response, got $code"
      ;;
  esac
  echo "$body"
}

# Sets AUTH_HEADER from a register/login response body if it carries
# `data.token` (pre-cookie-auth releases); otherwise leaves it unset and
# relies on the cookie jar already updated by curl's -c above.
adopt_credential() {
  local body="$1"
  local token
  token="$(echo "$body" | jq -r '.data.token // empty')"
  [ -n "$token" ] && AUTH_HEADER="$token"
}

log "Registering ${TEST_EMAIL}"
resp="$(curl_json POST /api/app/auth/register "$(jq -n --arg email "$TEST_EMAIL" --arg password "$TEST_PASSWORD" '{email:$email,password:$password,firstName:"Smoke",lastName:"Test"}')")"
body="$(expect_2xx "$resp" "register")"
adopt_credential "$body"
org_id="$(echo "$body" | jq -r '.data.user.organizations[0].id')"
[ -n "$org_id" ] && [ "$org_id" != "null" ] || fail "register did not return an organization id"
log "Registered, organizationId=${org_id}, auth mode=$([ -n "$AUTH_HEADER" ] && echo bearer || echo cookie)"

log "Logging in with the same credentials"
AUTH_HEADER=""
resp="$(curl_json POST /api/app/auth/login "$(jq -n --arg email "$TEST_EMAIL" --arg password "$TEST_PASSWORD" '{email:$email,password:$password}')")"
body="$(expect_2xx "$resp" "login")"
adopt_credential "$body"

log "Fetching /auth/me"
resp="$(curl_json GET /api/app/auth/me)"
body="$(expect_2xx "$resp" "auth/me")"
domains="$(echo "$body" | jq -r '.data.config.emailInboxDomains | join(",")')"
[ "$domains" = "$TEST_DOMAIN" ] || fail "auth/me config.emailInboxDomains=[${domains}], expected [${TEST_DOMAIN}]"

log "Creating an inbox on ${TEST_DOMAIN}"
resp="$(curl_json POST /api/app/emailInbox "$(jq -n --arg org "$org_id" --arg email "smoke@${TEST_DOMAIN}" '{organizationId:$org,email:$email,name:"Smoke Test Inbox"}')")"
body="$(expect_2xx "$resp" "create inbox")"
inbox_id="$(echo "$body" | jq -r '.data.id')"
[ -n "$inbox_id" ] && [ "$inbox_id" != "null" ] || fail "create inbox did not return an id"
log "Created inbox ${inbox_id}"

log "Listing inboxes"
resp="$(curl_json GET /api/app/emailInbox)"
body="$(expect_2xx "$resp" "list inboxes")"
found="$(echo "$body" | jq --arg id "$inbox_id" '[.data[] | select(.id == $id)] | length')"
[ "$found" = "1" ] || fail "created inbox ${inbox_id} not found in list response"

log "Logging out (best-effort — some releases predate this route)"
resp="$(curl_json POST /api/app/auth/logout)"
logout_code="$(tail -n1 <<<"$resp")"
case "$logout_code" in
  2??) log "Logged out" ;;
  404) log "No /auth/logout route on this release — skipping" ;;
  *) fail "logout: unexpected HTTP $logout_code" ;;
esac

echo
echo "PASSED: ${IMAGE_TAG} boots, migrates, and serves the register -> login -> create-inbox -> list golden path."
