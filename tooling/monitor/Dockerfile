# @corporax/monitor — container image.
#
# BUILD CONTEXT = repo root (arbitrum/), NOT this directory, because the ABI sync
# (scripts/sync-abi.mjs) reads ../../abis/index.ts and address resolution reads
# ../../deployments/<chainId>.json. Build with:
#
#   docker build -t corporax-monitor -f tooling/monitor/Dockerfile .
#
# Run with RPC_URL + CHAIN_ID (+ optional ALERT_WEBHOOK_URL):
#
#   docker run --rm -e RPC_URL=$RPC_URL -e CHAIN_ID=46630 \
#     -e ALERT_WEBHOOK_URL=$ALERT_WEBHOOK_URL corporax-monitor

# ---- build stage -----------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /repo

# The package + the two repo dirs it reads at build time.
COPY tooling/monitor/package.json tooling/monitor/package-lock.json* tooling/monitor/
COPY abis/ abis/
COPY deployments/ deployments/

WORKDIR /repo/tooling/monitor
# Use npm (corepack/pnpm is broken on the dev machine). Fall back to install if
# no lockfile was copied.
RUN npm ci || npm install

# Bring in sources and build (prebuild runs sync-abi.mjs against /repo/abis).
COPY tooling/monitor/ ./
RUN npm run build

# ---- runtime stage ---------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo/tooling/monitor

# Production deps only.
COPY tooling/monitor/package.json tooling/monitor/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Built JS, the synced ABI (lives under src/generated, copied via dist? no —
# dist/generated holds the compiled copy), and the repo dirs the runtime reads.
COPY --from=build /repo/tooling/monitor/dist ./dist
COPY --from=build /repo/abis /repo/abis
COPY --from=build /repo/deployments /repo/deployments

# Drop privileges.
USER node

# Default: run the monitoring service. Override CMD with ["dist/cli.js","check"]
# for a one-shot health probe.
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["start"]
