#!/usr/bin/env sh
# ============================================================================
# infra/deployer-entrypoint.sh — one-shot CorporaX bootstrapper.
#
# Used by the `deployer` service in docker-compose.yml. It:
#   1. waits until the anvil RPC is accepting requests,
#   2. runs Deploy.s.sol  (writes deployments/<chainId>.json), then
#   3. runs Seed.s.sol     (announces + funds a CLAIMABLE TSLA dividend and
#      writes deployments/proofs-<chainId>-<id>.json).
#
# Both scripts write into the repo's /deployments via foundry.toml
# fs_permissions; mount the repo so the frontend can read the artifacts.
#
# Required env:
#   RPC_URL       anvil endpoint        (default http://anvil:8545)
#   PRIVATE_KEY   deployer/issuer key   (default = anvil account #0)
# Optional env (see contracts/script/Deploy.s.sol header):
#   ADMIN_ADDRESS ISSUER_ADDRESS AUTO_ATTEST
#   USDG_ADDRESS  TSLA_ADDRESS   AMZN_ADDRESS   (leave unset on local -> mocks)
# ============================================================================
set -eu

RPC_URL="${RPC_URL:-http://anvil:8545}"
# Default to the canonical anvil account #0 (admin/issuer in Deploy.s.sol).
PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
export PRIVATE_KEY

echo "[deployer] waiting for anvil at ${RPC_URL} ..."
# Poll the RPC with cast until it answers (bounded retry, ~60s).
i=0
until cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "[deployer] ERROR: anvil did not become ready in time" >&2
    exit 1
  fi
  sleep 1
done
echo "[deployer] anvil is up (block $(cast block-number --rpc-url "$RPC_URL"))."

# forge scripts must run from contracts/ (foundry.toml + fs_permissions live there).
cd /work/contracts

echo "[deployer] running Deploy.s.sol ..."
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" \
  --broadcast

echo "[deployer] running Seed.s.sol ..."
forge script script/Seed.s.sol:Seed \
  --rpc-url "$RPC_URL" \
  --broadcast

echo "[deployer] done. Wrote deployments/<chainId>.json + proofs-<chainId>-<id>.json."
