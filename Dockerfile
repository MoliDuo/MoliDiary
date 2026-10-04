FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next build only imports modules; it never opens a connection.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/limen
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm run build:tools

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# The standalone server would exit at once on SIGTERM; shutdown is ours, so a
# deploy lets AI jobs in flight finish first.
ENV NEXT_MANUAL_SIG_HANDLE=true

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
# Migration and key-management CLIs, bundled so the image needs no tsx.
COPY --from=builder --chown=node:node /app/dist/tools ./tools
COPY --chmod=755 docker-entrypoint.sh ./

# The commit the deploy builds from. /healthz reports it so the deploy can confirm
# what is running. Set last so a new commit does not invalidate the layers above.
ARG VERSION=dev
ENV APP_VERSION=$VERSION

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
