# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /repo

# --- deps: install the full workspace so apps/api can resolve @voiceplatform/* ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm install --frozen-lockfile

# --- build: build shared first, then tsc the api workspace ---
FROM base AS build
COPY --from=deps /repo /repo
COPY apps/api ./apps/api
# Turbo respects the build dependency graph: shared compiles before api.
RUN pnpm exec turbo run build --filter=@voiceplatform/api

# --- run: prod-only deps, built shared + api dist ---
FROM base AS run
ENV NODE_ENV=production
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm install --frozen-lockfile --prod
# Built shared/dist is required at runtime — api's "import @voiceplatform/shared"
# resolves to packages/shared/dist/index.js per its package.json main field.
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/api/dist ./apps/api/dist
WORKDIR /repo/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/main.js"]
