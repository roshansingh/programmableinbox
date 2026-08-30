---
sidebar_position: 4
title: Upgrading
---

# Upgrading

## Docker deployments

```bash
docker compose pull
docker compose up -d
```

Pin to a specific release rather than always taking `latest` by setting
`IMAGE_TAG=vX.Y.Z` in `.env` before pulling. Check the
[release notes](https://github.com/roshansingh/programmableinbox/releases)
for the target version for any migration or environment-variable changes
before rolling forward.

## From-source deployments

```bash
git pull
npm install
npx prisma migrate deploy
npm run build
```

Restart the app process after the build completes. Run `npx prisma migrate
deploy` (not `migrate dev`) in production — it applies pending migrations
without prompting or generating new ones.

## Rolling back

Database migrations in this project are additive by convention; check a
release's notes for any migration explicitly marked as requiring a manual
rollback step before reverting the application version underneath it.
