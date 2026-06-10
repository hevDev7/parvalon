#!/usr/bin/env bash
# ============================================================================
# CorporaX — issuer onboarding (P1-9). registry.setAssetIssuer(asset, issuer).
#
# Authorizes `issuer` as the transfer-agent ops account for `asset` (the address
# allowed to fund/sweep that asset's dividends). Two paths, auto-selected by who
# holds DEFAULT_ADMIN_ROLE on the registry:
#
#   DIRECT   — the admin is the signer (PRIVATE_KEY): sends the tx with cast and
#              verifies assetIssuer(asset) == issuer.
#   GOVERNED — the admin is a TimelockController (post-handover): prints the
#              `schedule(...)` and `execute(...)` calldata to submit through the
#              Safe (proposer) and, after the delay, again to execute. Nothing is
#              broadcast in this mode.
#
# USAGE
#   scripts/onboard-issuer.sh <asset> <issuer>
#
# ENV
#   RPC_URL        (required) target RPC (e.g. $ROBINHOOD_TESTNET_RPC_URL)
#   PRIVATE_KEY    (required for DIRECT path) admin signer
#   REGISTRY_ADDRESS (optional) override; else deployments/<chainId>.json .registry
#   TIMELOCK_ADDRESS (optional) override; else deployments/governance-<chainId>.json .timelock
#   TIMELOCK_DELAY (optional) seconds to put in schedule() (default: timelock.getMinDelay())
#   TIMELOCK_SALT  (optional) bytes32 salt for schedule/execute (default: 0x00..00)
#
# See docs/ONBOARDING.md for the full operator walkthrough + Safe submission.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYMENTS="$ROOT/deployments"

die() { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

need cast; need jq

ASSET="${1:?usage: onboard-issuer.sh <asset> <issuer>}"
ISSUER="${2:?usage: onboard-issuer.sh <asset> <issuer>}"
: "${RPC_URL:?set RPC_URL}"

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
DEPLOY_FILE="$DEPLOYMENTS/${CHAIN_ID}.json"
GOV_FILE="$DEPLOYMENTS/governance-${CHAIN_ID}.json"

REGISTRY="${REGISTRY_ADDRESS:-}"
if [ -z "$REGISTRY" ]; then
  [ -f "$DEPLOY_FILE" ] || die "no $DEPLOY_FILE and no REGISTRY_ADDRESS override"
  REGISTRY="$(jq -er '.registry' "$DEPLOY_FILE")"
fi

# Validate inputs are addresses.
cast --to-checksum-address "$ASSET"  >/dev/null || die "invalid asset address"
cast --to-checksum-address "$ISSUER" >/dev/null || die "invalid issuer address"

# Who is the registry admin? DEFAULT_ADMIN_ROLE = 0x00..00.
ADMIN_ROLE="0x0000000000000000000000000000000000000000000000000000000000000000"

# Determine the timelock (if any) and whether it holds admin.
TIMELOCK="${TIMELOCK_ADDRESS:-}"
if [ -z "$TIMELOCK" ] && [ -f "$GOV_FILE" ]; then
  TIMELOCK="$(jq -er '.timelock' "$GOV_FILE" 2>/dev/null || true)"
fi

# Calldata for the actual registry call (same in both paths).
CALLDATA="$(cast calldata 'setAssetIssuer(address,address)' "$ASSET" "$ISSUER")"

is_admin() { # is_admin <addr> -> "true"/"false"
  [ -z "$1" ] && { echo false; return; }
  cast call "$REGISTRY" 'hasRole(bytes32,address)(bool)' "$ADMIN_ROLE" "$1" --rpc-url "$RPC_URL"
}

# ---- GOVERNED path: timelock holds admin -----------------------------------
if [ -n "$TIMELOCK" ] && [ "$(is_admin "$TIMELOCK")" = "true" ]; then
  echo "GOVERNED: registry admin is the timelock $TIMELOCK"
  SALT="${TIMELOCK_SALT:-0x0000000000000000000000000000000000000000000000000000000000000000}"
  PREDECESSOR="0x0000000000000000000000000000000000000000000000000000000000000000"
  DELAY="${TIMELOCK_DELAY:-}"
  [ -n "$DELAY" ] || DELAY="$(cast call "$TIMELOCK" 'getMinDelay()(uint256)' --rpc-url "$RPC_URL")"

  SCHEDULE="$(cast calldata 'schedule(address,uint256,bytes,bytes32,bytes32,uint256)' \
    "$REGISTRY" 0 "$CALLDATA" "$PREDECESSOR" "$SALT" "$DELAY")"
  EXECUTE="$(cast calldata 'execute(address,uint256,bytes,bytes32,bytes32)' \
    "$REGISTRY" 0 "$CALLDATA" "$PREDECESSOR" "$SALT")"
  OPID="$(cast call "$TIMELOCK" 'hashOperation(address,uint256,bytes,bytes32,bytes32)(bytes32)' \
    "$REGISTRY" 0 "$CALLDATA" "$PREDECESSOR" "$SALT" --rpc-url "$RPC_URL")"

  cat <<EOF

Submit via the Safe (timelock proposer/executor). Two transactions, ${DELAY}s apart.

  operationId : $OPID
  inner call  : registry.setAssetIssuer($ASSET, $ISSUER)

  STEP 1 — schedule   (Safe -> timelock $TIMELOCK)
    to   : $TIMELOCK
    data : $SCHEDULE

  ... wait >= ${DELAY} seconds (timelock min delay) ...

  STEP 2 — execute    (Safe -> timelock $TIMELOCK)
    to   : $TIMELOCK
    data : $EXECUTE

Tip: track readiness with
  cast call $TIMELOCK 'isOperationReady(bytes32)(bool)' $OPID --rpc-url \$RPC_URL
EOF
  exit 0
fi

# ---- DIRECT path: an EOA admin signs ---------------------------------------
: "${PRIVATE_KEY:?DIRECT path needs PRIVATE_KEY (the registry admin)}"
SIGNER="$(cast wallet address --private-key "$PRIVATE_KEY")"
[ "$(is_admin "$SIGNER")" = "true" ] || die "signer $SIGNER does not hold DEFAULT_ADMIN_ROLE on $REGISTRY
   (if admin is a timelock, set TIMELOCK_ADDRESS / governance-<chainId>.json to use the governed path)"

PREV="$(cast call "$REGISTRY" 'assetIssuer(address)(address)' "$ASSET" --rpc-url "$RPC_URL")"
echo "DIRECT: $SIGNER (admin) -> setAssetIssuer($ASSET, $ISSUER)   [was: $PREV]"
cast send "$REGISTRY" 'setAssetIssuer(address,address)' "$ASSET" "$ISSUER" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" >/dev/null

NOW="$(cast call "$REGISTRY" 'assetIssuer(address)(address)' "$ASSET" --rpc-url "$RPC_URL")"
[ "$(echo "$NOW" | tr 'A-F' 'a-f')" = "$(echo "$ISSUER" | tr 'A-F' 'a-f')" ] \
  || die "verification failed: assetIssuer is $NOW, expected $ISSUER"
echo "OK: issuer for $ASSET is now $NOW"
