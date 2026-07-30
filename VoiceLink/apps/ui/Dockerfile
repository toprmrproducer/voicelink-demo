# syntax=docker/dockerfile:1.7
# Build context = monorepo root.
# Build with: docker build -f apps/ui/Dockerfile -t voice-platform-ui .

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /repo

# --- deps: install full workspace so workspace links resolve ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY apps/ui/package.json ./apps/ui/package.json
RUN pnpm install --frozen-lockfile

# --- build: build shared first (turbo dep graph), then next build standalone ---
FROM base AS build
COPY --from=deps /repo /repo
COPY apps/ui ./apps/ui
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec turbo run build --filter=@voiceplatform/ui

# --- run: copy ONLY the standalone bundle + static + public ---
FROM node:20-alpine AS run
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Standalone bundles a minimal node_modules + server.js inside apps/ui
COPY --from=build /repo/apps/ui/.next/standalone ./
COPY --from=build /repo/apps/ui/.next/static     ./apps/ui/.next/static
COPY --from=build /repo/apps/ui/public           ./apps/ui/public

EXPOSE 3000
# Use 127.0.0.1 explicitly: Next.js standalone binds IPv4 only, but Alpine's
# `localhost` resolves to ::1 (IPv6) first, which fails with "connection
# refused". Using 127.0.0.1 makes the healthcheck deterministic.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "apps/ui/server.js"]
