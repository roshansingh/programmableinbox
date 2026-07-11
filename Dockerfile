# syntax=docker/dockerfile:1.6

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL is unused by `prisma generate` and `next build`, but
# prisma.config.ts loads it via dotenv. Provide a dummy so the build is
# hermetic and never connects.
ENV DATABASE_URL=postgresql://dummy:dummy@127.0.0.1:5432/dummy
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=4000 \
    HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends wget openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r nodejs --gid 1001 && useradd -r -g nodejs --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# prisma.config.ts holds the datasource URL — Prisma 7 no longer allows `url` in
# the schema, so `migrate deploy` loads it from here.
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/lib/generated ./lib/generated
# Full node_modules (overlays the trimmed standalone copy). The `migrate` service
# runs the Prisma CLI, which loads prisma.config.ts via @prisma/config and its
# deep dep tree (c12, effect, jiti, dotenv, …); shipping the complete set avoids
# per-package whack-a-mole. The generated client itself lives in lib/generated.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
USER nextjs
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/healthz >/dev/null || exit 1
CMD ["node", "server.js"]
