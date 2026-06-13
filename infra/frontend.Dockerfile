# ============================================================================
# infra/frontend.Dockerfile — production image for the CorporaX Next.js app.
#
# Multi-stage build targeting Next.js "standalone" output (next.config:
# `output: "standalone"`), which traces only the runtime files needed and
# yields a small, non-root final image.
#
# Build context MUST be the repo root (the app is an npm workspace that shares
# the root package.json / lockfile and imports the sibling abis/ package):
#   docker build -f infra/frontend.Dockerfile -t corporax/frontend .
#
# Node 22 (alpine) matches the version used across CI so build/runtime behaviour
# is identical between the pipeline and the production image.
# ============================================================================

# --- Stage 1: dependencies --------------------------------------------------
# Install workspace deps once against the lockfile for reproducible builds.
FROM node:22-alpine AS deps
WORKDIR /app
# libc compat for some native deps (e.g. certain crypto/bigint addons).
RUN apk add --no-cache libc6-compat
# Copy only manifests first to maximize layer-cache reuse.
COPY package.json package-lock.json* ./
COPY app/package.json ./app/package.json
COPY tooling/snapshot/package.json ./tooling/snapshot/package.json
# `npm ci` when a lockfile is present; fall back to `npm install` otherwise.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# --- Stage 2: build ---------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
# Bring in the full source needed to build the app workspace.
COPY package.json package-lock.json* ./
COPY abis ./abis
COPY app ./app
# Disable Next telemetry in CI/container builds.
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are inlined at build time. Bake inert, non-secret defaults so
# the build never needs network/secrets; override real values at runtime only
# for server-read vars. (Browser-exposed NEXT_PUBLIC_* must be set at BUILD time
# to take effect — pass them as --build-arg or compose `args` for real deploys.)
ARG NEXT_PUBLIC_CHAIN_ID=31337
ARG NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
ARG NEXT_PUBLIC_BLOCKSCOUT_URL=https://explorer.testnet.chain.robinhood.com
ENV NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_BLOCKSCOUT_URL=$NEXT_PUBLIC_BLOCKSCOUT_URL
RUN npm -w @corporax/app run build

# --- Stage 3: runtime -------------------------------------------------------
# Minimal runner using the traced standalone server. Runs as the built-in
# non-root `node` user.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Copy the standalone server, static assets, and public/ with correct ownership.
COPY --from=builder --chown=node:node /app/app/.next/standalone ./
COPY --from=builder --chown=node:node /app/app/.next/static ./app/.next/static
COPY --from=builder --chown=node:node /app/app/public ./app/public
USER node
EXPOSE 3000
# Standalone emits server.js at the traced workspace path (app/server.js).
CMD ["node", "app/server.js"]
