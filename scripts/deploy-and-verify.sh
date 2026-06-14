#!/usr/bin/env bash
# ============================================================================
# Parvalon — reproducible deploy + verify + signed manifest (P0-8).
#
# WHAT IT DOES
#   1. Pins the Foundry toolchain (fails unless the running forge matches
#      FORGE_VERSION_PIN) so the same bytecode is produced everywhere.
#   2. Runs contracts/script/Deploy.s.sol with --broadcast --verify against the
#      target chain, using the foundry.toml [etherscan]/[rpc_endpoints] profiles
#      keyed to Blockscout (Robinhood Chain) or Arbiscan (Arbitrum Sepolia)
#      from INTEGRATION.md §8-9.
#   3. Builds a SIGNED deployment manifest: addresses + tx hashes + commit sha +
#      compiler/solc + build profile, then signs its sha256 with the deployer key
#      (cast wallet sign) so the provenance is verifiable on its own.
#   4. Optionally `git add && git commit` the manifest (COMMIT_MANIFEST=true).
#
# IDEMPOTENT: re-running with the same git commit + chain is safe. forge's
# broadcast cache means already-deployed contracts are re-used/skipped; the
# manifest is regenerated deterministically and overwritten in place. If you
# intend a fresh deploy, bump the commit or pass --resume / clean broadcasts.
#
# USAGE
#   scripts/deploy-and-verify.sh <network>
#     <network> ∈ robinhood_testnet | arbitrum_sepolia | localhost
#
# REQUIRED ENV (see .env.example / INTEGRATION.md §9)
#   PRIVATE_KEY                       deployer key (broadcaster + manifest signer)
#   robinhood_testnet:  ROBINHOOD_TESTNET_RPC_URL, ROBINHOOD_BLOCKSCOUT_API_URL, BLOCKSCOUT_API_KEY
#   arbitrum_sepolia:   ARBITRUM_SEPOLIA_RPC_URL, ARBISCAN_API_KEY
#   localhost:          (anvil at 127.0.0.1:8545; no verification)
# OPTIONAL ENV
#   ADMIN_ADDRESS, ISSUER_ADDRESS, AUTO_ATTEST, USDG_ADDRESS, TSLA_ADDRESS, AMZN_ADDRESS
#   FORGE_VERSION_PIN   expected `forge --version` commit/semver substring (default below)
#   COMMIT_MANIFEST     "true" to git add+commit the manifest (default false)
#   SKIP_VERIFY         "true" to deploy without --verify (e.g. explorer down)
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS="$ROOT/contracts"
DEPLOYMENTS="$ROOT/deployments"
MANIFESTS="$DEPLOYMENTS/manifests"

# Pin the toolchain to the version this repo's lockfile + bytecode_hash="none"
# settings were validated against. Update deliberately, not by accident.
FORGE_VERSION_PIN="${FORGE_VERSION_PIN:-1.5.1}"

die() { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

need forge
need cast
need jq
need git

NETWORK="${1:-}"
[ -n "$NETWORK" ] || die "usage: scripts/deploy-and-verify.sh <robinhood_testnet|arbitrum_sepolia|localhost>"
: "${PRIVATE_KEY:?set PRIVATE_KEY}"

# ---- 1. Pin the toolchain --------------------------------------------------
FORGE_VER="$(forge --version 2>/dev/null || true)"
case "$FORGE_VER" in
  *"$FORGE_VERSION_PIN"*) echo "forge pin OK: matches '$FORGE_VERSION_PIN'" ;;
  *) die "forge version mismatch: expected to contain '$FORGE_VERSION_PIN', got: $FORGE_VER
        (set FORGE_VERSION_PIN to override, or 'foundryup -v <ver>')" ;;
esac

# ---- 2. Resolve network -> rpc + verifier ----------------------------------
VERIFY_ARGS=()
case "$NETWORK" in
  robinhood_testnet)
    : "${ROBINHOOD_TESTNET_RPC_URL:?}"
    RPC_URL="$ROBINHOOD_TESTNET_RPC_URL"
    if [ "${SKIP_VERIFY:-false}" != "true" ]; then
      : "${ROBINHOOD_BLOCKSCOUT_API_URL:?}" ; : "${BLOCKSCOUT_API_KEY:?}"
      # Blockscout uses the Etherscan-compatible verifier with an explicit URL.
      VERIFY_ARGS=(--verify --verifier blockscout --verifier-url "$ROBINHOOD_BLOCKSCOUT_API_URL")
    fi
    ;;
  arbitrum_sepolia)
    : "${ARBITRUM_SEPOLIA_RPC_URL:?}"
    RPC_URL="$ARBITRUM_SEPOLIA_RPC_URL"
    if [ "${SKIP_VERIFY:-false}" != "true" ]; then
      : "${ARBISCAN_API_KEY:?}"
      VERIFY_ARGS=(--verify --verifier etherscan --etherscan-api-key "$ARBISCAN_API_KEY")
    fi
    ;;
  localhost)
    RPC_URL="http://127.0.0.1:8545"
    SKIP_VERIFY=true
    ;;
  *) die "unknown network '$NETWORK'" ;;
esac

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
COMMIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"
GIT_DIRTY="clean"; git -C "$ROOT" diff --quiet || GIT_DIRTY="dirty"
SOLC_VERSION="$(awk -F'"' '/solc_version/ {print $2; exit}' "$CONTRACTS/foundry.toml")"
DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY")"

echo "network=$NETWORK chainId=$CHAIN_ID commit=$COMMIT_SHA ($GIT_DIRTY) solc=$SOLC_VERSION deployer=$DEPLOYER"
[ "$GIT_DIRTY" = "clean" ] || echo "WARNING: working tree is dirty — manifest provenance will reflect uncommitted changes."

# ---- 3. Deploy + verify ----------------------------------------------------
echo "==> forge script Deploy.s.sol --broadcast ${VERIFY_ARGS[*]:-(no verify)}"
forge script "$CONTRACTS/script/Deploy.s.sol:Deploy" \
  --root "$CONTRACTS" \
  --rpc-url "$RPC_URL" \
  --broadcast \
  --slow \
  "${VERIFY_ARGS[@]+"${VERIFY_ARGS[@]}"}"

# Deploy.s.sol writes deployments/<chainId>.json; the broadcast log holds tx hashes.
DEPLOY_FILE="$DEPLOYMENTS/${CHAIN_ID}.json"
[ -f "$DEPLOY_FILE" ] || die "expected $DEPLOY_FILE after deploy"
BROADCAST_LOG="$CONTRACTS/broadcast/Deploy.s.sol/${CHAIN_ID}/run-latest.json"

# ---- 4. Build the signed manifest ------------------------------------------
mkdir -p "$MANIFESTS"
MANIFEST="$MANIFESTS/${NETWORK}-${CHAIN_ID}.json"
TX_HASHES='[]'
if [ -f "$BROADCAST_LOG" ]; then
  TX_HASHES="$(jq -c '[.transactions[]? | {contractName, contractAddress, hash}]' "$BROADCAST_LOG" 2>/dev/null || echo '[]')"
fi

# Deterministic manifest body (no timestamps inside the signed payload, so a
# re-deploy from the same inputs yields a byte-stable, comparable artifact).
MANIFEST_BODY="$(jq -n \
  --arg network "$NETWORK" \
  --argjson chainId "$CHAIN_ID" \
  --arg commit "$COMMIT_SHA" \
  --arg gitState "$GIT_DIRTY" \
  --arg solc "$SOLC_VERSION" \
  --arg forge "$FORGE_VER" \
  --arg deployer "$DEPLOYER" \
  --slurpfile addresses "$DEPLOY_FILE" \
  --argjson txs "$TX_HASHES" \
  '{network:$network, chainId:$chainId, commitSha:$commit, gitState:$gitState,
    compiler:{solc:$solc, forge:$forge, bytecodeHash:"none", optimizer:true, optimizerRuns:200},
    deployer:$deployer, addresses:$addresses[0], transactions:$txs}')"

# Sign sha256(manifest body) with the deployer key -> verifiable provenance.
BODY_HASH="$(printf '%s' "$MANIFEST_BODY" | cast keccak)"
SIGNATURE="$(cast wallet sign --private-key "$PRIVATE_KEY" "$BODY_HASH")"

jq -n \
  --argjson body "$MANIFEST_BODY" \
  --arg bodyHash "$BODY_HASH" \
  --arg signer "$DEPLOYER" \
  --arg signature "$SIGNATURE" \
  --arg signedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '$body + {provenance:{bodyKeccak:$bodyHash, signer:$signer, signature:$signature, signedAt:$signedAt}}' \
  > "$MANIFEST"

echo "wrote signed manifest: $MANIFEST"
echo "  verify later with: cast wallet verify --address $DEPLOYER \"\$(jq -er .provenance.bodyKeccak $MANIFEST)\" \"\$(jq -er .provenance.signature $MANIFEST)\""

# ---- 5. Optional commit ----------------------------------------------------
if [ "${COMMIT_MANIFEST:-false}" = "true" ]; then
  git -C "$ROOT" add "$MANIFEST" "$DEPLOY_FILE"
  git -C "$ROOT" commit -m "deploy($NETWORK): $CHAIN_ID @ ${COMMIT_SHA:0:12}" \
    -m "Signed deployment manifest. solc=$SOLC_VERSION forge='$FORGE_VER'." || echo "nothing to commit"
  echo "committed manifest."
else
  echo "COMMIT_MANIFEST!=true — manifest written but not committed."
fi

echo "DONE."
