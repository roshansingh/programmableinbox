---
sidebar_position: 4
title: Upgrading
---

# Upgrading

```bash
docker compose pull
docker compose up -d
```

The `app` service's startup command runs `prisma migrate deploy` before
starting the server (see [Quickstart (Docker)](quickstart-docker)), so this
pull-and-restart picks up both the new image and any pending schema
migrations in one step — there's no separate migration step to remember.

Pin to a specific release rather than always taking `latest` by setting
`IMAGE_TAG=vX.Y.Z` in `.env` before pulling. Check the
[release notes](https://github.com/roshansingh/programmableinbox/releases)
for the target version for any migration or environment-variable changes
before rolling forward.

## Rolling back

Database migrations in this project are additive by convention; check a
release's notes for any migration explicitly marked as requiring a manual
rollback step before reverting the application version underneath it. To
roll back, set `IMAGE_TAG` in `.env` to the previous version and re-run the
commands above.
