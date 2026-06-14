#!/usr/bin/env bash
# ============================================================================
# Parvalon — emergency DRILLS (P0-7). cast-based incident playbook.
#
# Exercises the live emergency controls against a deployment and VERIFIES each
# step, so a drill that silently fails to take effect exits non-zero:
#   - pause   -> verify paused()   -> unpause -> verify !paused()   (registry + distributor)
#   - issuer rotation: setAssetIssuer(asset, newIssuer) -> verify assetIssuer()
#
# This is the cast twin of contracts/script/Drills.s.sol. Use either; this one
# needs no forge/solc, just cast + jq, so it runs from a minimal responder box.
#
# USAGE
#   scripts/drills.sh pause-all
#   scripts/drills.sh unpause-all
#   scripts/drills.sh pause-distributor
#   scripts/drills.sh unpause-distributor
#   scripts/drills.sh full            # pause-all -> status -> unpause-all (round trip)
#   scripts/drills.sh rotate-issuer <asset> <newIssuer>
#   scripts/drills.sh status
#
# ENV (read from the shell / .env)
#   RPC_URL         (required) target RPC, e.g. $ROBINHOOD_TESTNET_RPC_URL
#   PRIVATE_KEY     (required for write drills) signer; must hold the role:
#                     PAUSER_ROLE        for pause/unpause
#                     DEFAULT_ADMIN_ROLE for rotate-issuer
#   REGISTRY_ADDRESS / DISTRIBUTOR_ADDRESS  (optional) override; else read from
#                     deployments/<chainId>.json by the RPC's reported chain id.
#
# GOVERNANCE: after handover, PAUSER_ROLE is on the Safe and admin on the
# timelock — an EOA cannot run the write drills. Use `status` here to observe,
# and submit pause()/setAssetIssuer() through the Safe/timelock (the Drills.s.sol
# *DryRun functions print the exact calldata). See docs/DR.md and docs/RUNBOOK.md.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYMENTS="$ROOT/deployments"

die() { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

# Help works with no env/deps so an operator can read usage on any box.
case "${1:-}" in
  ""|-h|--help|help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

need cast
need jq

: "${RPC_URL:?set RPC_URL (e.g. export RPC_URL=\$ROBINHOOD_TESTNET_RPC_URL)}"

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
DEPLOY_FILE="$DEPLOYMENTS/${CHAIN_ID}.json"

resolve_addr() {
  # resolve_addr <ENV_OVERRIDE_NAME> <json_key>
  local override="${!1:-}"
  if [ -n "$override" ]; then echo "$override"; return; fi
  [ -f "$DEPLOY_FILE" ] || die "no deployment file $DEPLOY_FILE and no $1 override"
  jq -er ".$2" "$DEPLOY_FILE" 2>/dev/null || die "key .$2 not found in $DEPLOY_FILE"
}

REGISTRY="$(resolve_addr REGISTRY_ADDRESS registry)"
DISTRIBUTOR="$(resolve_addr DISTRIBUTOR_ADDRESS distributor)"

# read a bool view (paused()) -> "true"/"false". `cast call …(bool)` already
# decodes to the literal "true"/"false"; trim any whitespace defensively.
read_bool() { cast call "$1" "$2" --rpc-url "$RPC_URL" | tr -d '[:space:]'; }

send() {
  # send <to> <sig> [args...]  — requires PRIVATE_KEY
  : "${PRIVATE_KEY:?set PRIVATE_KEY for write drills}"
  cast send "$@" --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" >/dev/null
}

assert_eq() { [ "$1" = "$2" ] || die "assertion failed: expected '$2', got '$1'  ($3)"; }

cmd_status() {
  echo "chainId            : $CHAIN_ID"
  echo "registry           : $REGISTRY"
  echo "  paused           : $(read_bool "$REGISTRY" 'paused()(bool)')"
  echo "  actionSource     : $(cast call "$REGISTRY" 'actionSource()(address)' --rpc-url "$RPC_URL")"
  echo "distributor        : $DISTRIBUTOR"
  echo "  paused           : $(read_bool "$DISTRIBUTOR" 'paused()(bool)')"
}

cmd_pause_all() {
  echo "[drill] pausing registry + distributor ..."
  send "$REGISTRY" 'pause()'
  send "$DISTRIBUTOR" 'pause()'
  assert_eq "$(read_bool "$REGISTRY" 'paused()(bool)')" "true" "registry should be paused"
  assert_eq "$(read_bool "$DISTRIBUTOR" 'paused()(bool)')" "true" "distributor should be paused"
  echo "[drill] OK: both paused."
}

cmd_unpause_all() {
  echo "[drill] unpausing registry + distributor ..."
  send "$REGISTRY" 'unpause()'
  send "$DISTRIBUTOR" 'unpause()'
  assert_eq "$(read_bool "$REGISTRY" 'paused()(bool)')" "false" "registry should be live"
  assert_eq "$(read_bool "$DISTRIBUTOR" 'paused()(bool)')" "false" "distributor should be live"
  echo "[drill] OK: both live."
}

cmd_pause_distributor() {
  echo "[drill] pausing distributor only ..."
  send "$DISTRIBUTOR" 'pause()'
  assert_eq "$(read_bool "$DISTRIBUTOR" 'paused()(bool)')" "true" "distributor should be paused"
  echo "[drill] OK: distributor paused (claims frozen; registry still live)."
}

cmd_unpause_distributor() {
  echo "[drill] unpausing distributor only ..."
  send "$DISTRIBUTOR" 'unpause()'
  assert_eq "$(read_bool "$DISTRIBUTOR" 'paused()(bool)')" "false" "distributor should be live"
  echo "[drill] OK: distributor live."
}

cmd_full() {
  echo "=== FULL pause->verify->unpause round-trip drill ==="
  cmd_status
  cmd_pause_all
  cmd_status
  cmd_unpause_all
  cmd_status
  echo "=== FULL drill complete ==="
}

cmd_rotate_issuer() {
  local asset="${1:?usage: rotate-issuer <asset> <newIssuer>}"
  local new_issuer="${2:?usage: rotate-issuer <asset> <newIssuer>}"
  local prev
  prev="$(cast call "$REGISTRY" 'assetIssuer(address)(address)' "$asset" --rpc-url "$RPC_URL")"
  echo "[drill] rotating issuer for $asset : $prev -> $new_issuer"
  send "$REGISTRY" 'setAssetIssuer(address,address)' "$asset" "$new_issuer"
  local now
  now="$(cast call "$REGISTRY" 'assetIssuer(address)(address)' "$asset" --rpc-url "$RPC_URL")"
  # normalize case for comparison
  assert_eq "$(echo "$now" | tr 'A-F' 'a-f')" "$(echo "$new_issuer" | tr 'A-F' 'a-f')" "issuer should be rotated"
  echo "[drill] OK: issuer for $asset is now $now"
}

case "${1:-}" in
  status)              cmd_status ;;
  pause-all)           cmd_pause_all ;;
  unpause-all)         cmd_unpause_all ;;
  pause-distributor)   cmd_pause_distributor ;;
  unpause-distributor) cmd_unpause_distributor ;;
  full)                cmd_full ;;
  rotate-issuer)       shift; cmd_rotate_issuer "$@" ;;
  *) die "unknown command '$1' (try: scripts/drills.sh help)" ;;
esac
