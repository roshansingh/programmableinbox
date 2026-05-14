# Runbook 01 — App crash or bad deploy

**Symptom**: `app-healthz` monitor red; app container restart-looping; users report 5xx.

**RTO target**: <5 minutes.

## 1. Triage

```bash
ssh deploy@$HOST
cd /srv/inboxui
docker compose ps
docker compose logs --tail=200 app caddy
```

If the app is crash-looping (`restarting (N)` in `ps`), capture the last log lines before they scroll off:

```bash
docker compose logs --tail=500 app > /tmp/app-crash-$(date +%s).log
```

## 2. Rollback the deploy

Identify the previous good SHA from `git log` on the deploy host, or from the GitHub Actions history. Then:

```bash
IMAGE_TAG=<previous-sha> /srv/inboxui/deploy.sh <previous-sha>
```

`deploy.sh` will pull, re-run migrations (no-op if schema is unchanged), and roll the app behind a healthcheck gate.

## 3. Verify

```bash
curl -fsS https://$DOMAIN/api/healthz | jq
```

Status 200, `db: ok`, `freshness_breach: false`.

## 4. Postmortem

- File a ticket linking to the offending commit.
- Do not re-merge to `main` until the root cause is identified.
- If the cause was a missing env var, update `secrets/app.env` AND document the variable in `deploy/README.md` so it isn't missed next time.
