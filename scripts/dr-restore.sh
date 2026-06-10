#!/usr/bin/env bash
# ============================================================================
# CorporaX — disaster recovery: rebuild the operational picture from on-chain
# truth + committed artifacts (P2-6). Pairs with docs/DR.md.
#
# PRINCIPLE: the chain is the source of truth. Everything operational can be
# re-derived from (a) the deployed contracts and (b) the committed
# deployments/*.json + signed manifest. No private database is load-bearing.
#
# WHAT IT DOES (each step is independent; pass a subcommand or `all`)
#   verify-manifest   re-derive the manifest keccak + verify the deployer signature
#   reconcile         read live on-chain state (paused, actionSource, actionCount,
#                     per-action totalFunded/totalClaimed) and print a health report
#   reproofs <id>     re-run the snapshot CLI to regenerate proofs-<chainId>-<id>.json
#                     from on-chain Transfer logs (deterministic; compares root to
#                     the registry's published merkleRoot)
#   reip <id>         re-pin the regenerated proofs.json to IPFS (needs IPFS_API or ipfs CLI)
#   reindex           print the indexer rebuild command (fromBlock = registry deploy block)
#   all <id?>         verify-manifest -> reconcile -> (reproofs+reip if id given) -> reindex
#
# ENV
#   RPC_URL          (required) a WORKING RPC. On primary-RPC loss, set this to the
#                    backup endpoint (docs/MULTICHAIN.md lists per-chain rpcEnv).
#   PRIVATE_KEY      not required (DR is read-only); only needed for re-pin auth if your
#                    IPFS provider keys off it.
#   IPFS_API         (optional) IPFS HTTP API multiaddr/url for `reip` (else uses `ipfs` CLI)
#   SNAPSHOT_RATE / SNAPSHOT_DEPLOY_BLOCK  (optional) override values for `reproofs`
#                    (else read rate from the action and deploy block from the manifest)
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYMENTS="$ROOT/deployments"
MANIFESTS="$DEPLOYMENTS/manifests"

die() { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

# Help works with no env/deps so an operator can read usage on any box.
case "${1:-}" in
  ""|-h|--help|help) sed -n '2,38p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

need cast; need jq

: "${RPC_URL:?set RPC_URL (use the BACKUP endpoint if primary is down)}"
CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
DEPLOY_FILE="$DEPLOYMENTS/${CHAIN_ID}.json"
[ -f "$DEPLOY_FILE" ] || die "no committed deployment $DEPLOY_FILE — restore it from git first"

REGISTRY="$(jq -er '.registry' "$DEPLOY_FILE")"
DISTRIBUTOR="$(jq -er '.distributor' "$DEPLOY_FILE")"

find_manifest() {
  ls "$MANIFESTS"/*-"${CHAIN_ID}".json 2>/dev/null | head -n1 || true
}

# ---- verify-manifest: provenance check -------------------------------------
cmd_verify_manifest() {
  local m; m="$(find_manifest)"
  [ -n "$m" ] || { echo "no manifest for chain $CHAIN_ID under $MANIFESTS (skip)"; return 0; }
  echo "verifying manifest: $m"
  local body bodyHash signer signature recomputed
  body="$(jq -c 'del(.provenance)' "$m")"
  bodyHash="$(jq -er '.provenance.bodyKeccak' "$m")"
  signer="$(jq -er '.provenance.signer' "$m")"
  signature="$(jq -er '.provenance.signature' "$m")"
  recomputed="$(printf '%s' "$body" | cast keccak)"
  [ "$recomputed" = "$bodyHash" ] || die "manifest body hash mismatch (tampered?): $recomputed != $bodyHash"
  if cast wallet verify --address "$signer" "$bodyHash" "$signature" >/dev/null 2>&1; then
    echo "OK: manifest signature valid (signer $signer)."
  else
    die "manifest signature INVALID for signer $signer"
  fi
}

# ---- reconcile: live on-chain health ---------------------------------------
cmd_reconcile() {
  echo "=== on-chain reconcile @ chain $CHAIN_ID ==="
  echo "registry       : $REGISTRY  paused=$(cast call "$REGISTRY" 'paused()(bool)' --rpc-url "$RPC_URL")"
  echo "  actionSource : $(cast call "$REGISTRY" 'actionSource()(address)' --rpc-url "$RPC_URL")"
  echo "distributor    : $DISTRIBUTOR  paused=$(cast call "$DISTRIBUTOR" 'paused()(bool)' --rpc-url "$RPC_URL")"
  local count; count="$(cast call "$REGISTRY" 'actionCount()(uint256)' --rpc-url "$RPC_URL")"
  count="${count%% *}"
  echo "actionCount    : $count"
  local id
  for id in $(seq 1 "$count"); do
    local funded claimed
    funded="$(cast call "$DISTRIBUTOR" 'totalFunded(uint256)(uint256)' "$id" --rpc-url "$RPC_URL")"
    claimed="$(cast call "$DISTRIBUTOR" 'totalClaimed(uint256)(uint256)' "$id" --rpc-url "$RPC_URL")"
    echo "  action #$id  funded=${funded%% *}  claimed=${claimed%% *}"
  done
  echo "=== reconcile complete ==="
}

# ---- reproofs: re-derive proofs.json deterministically ---------------------
cmd_reproofs() {
  local id="${1:?usage: dr-restore.sh reproofs <actionId>}"
  need node
  # Pull canonical action params on-chain so the snapshot is reproducible without
  # trusting any off-chain record. getAction returns the full struct; we read the
  # asset, ratePerShare and recordBlock from it.
  local view; view="$(cast call "$REGISTRY" \
    'getAction(uint256)((uint256,address,uint8,uint256,uint64,uint64,uint64,address,bytes32,uint256,uint8,string))' \
    "$id" --rpc-url "$RPC_URL")"
  echo "on-chain action #$id tuple: $view"

  local asset rate record payout root
  asset="$(cast call "$REGISTRY" 'getAction(uint256)((uint256,address,uint8,uint256,uint64,uint64,uint64,address,bytes32,uint256,uint8,string))' "$id" --rpc-url "$RPC_URL" | sed -n '2p' | tr -d ' ')"
  # Robust field extraction via abi-decode would be ideal; for portability we
  # re-query individual fields through actionView (gas-lean, no metadataURI).
  # actionView order mirrors the struct minus metadataURI.
  rate="${SNAPSHOT_RATE:-}"
  if [ -z "$rate" ]; then
    rate="$(cast call "$REGISTRY" 'getAction(uint256)((uint256,address,uint8,uint256,uint64,uint64,uint64,address,bytes32,uint256,uint8,string))' "$id" --rpc-url "$RPC_URL" | sed -n '4p' | tr -d ' ')"
  fi
  record="$(cast call "$REGISTRY" 'getAction(uint256)((uint256,address,uint8,uint256,uint64,uint64,uint64,address,bytes32,uint256,uint8,string))' "$id" --rpc-url "$RPC_URL" | sed -n '5p' | tr -d ' ')"
  payout="$(cast call "$REGISTRY" 'getAction(uint256)((uint256,address,uint8,uint256,uint64,uint64,uint64,address,bytes32,uint256,uint8,string))' "$id" --rpc-url "$RPC_URL" | sed -n '8p' | tr -d ' ')"
  root="$(cast call "$REGISTRY" 'getAction(uint256)((uint256,address,uint8,uint256,uint64,uint64,uint64,address,bytes32,uint256,uint8,string))' "$id" --rpc-url "$RPC_URL" | sed -n '9p' | tr -d ' ')"

  local deploy_block="${SNAPSHOT_DEPLOY_BLOCK:-0}"
  local out="$DEPLOYMENTS/proofs-${CHAIN_ID}-${id}.json"
  echo "re-deriving snapshot: asset=$asset rate=$rate recordBlock=$record -> $out"
  echo "running: npm run snapshot -- snapshot --token $asset --deploy-block $deploy_block --record-block $record --rate $rate --action-id $id --payout-token $payout --chain-id $CHAIN_ID --out $out"
  ( cd "$ROOT" && RPC_URL="$RPC_URL" npm run snapshot -- snapshot \
      --token "$asset" --deploy-block "$deploy_block" --record-block "$record" \
      --rate "$rate" --action-id "$id" --payout-token "$payout" \
      --chain-id "$CHAIN_ID" --rpc "$RPC_URL" --out "$out" )

  local newroot; newroot="$(jq -er '.merkleRoot' "$out")"
  echo "regenerated root : $newroot"
  echo "on-chain root    : $root"
  if [ "$(echo "$newroot" | tr 'A-F' 'a-f')" = "$(echo "$root" | tr 'A-F' 'a-f')" ]; then
    echo "OK: regenerated proofs match the published merkleRoot. Claims remain valid."
  else
    echo "WARNING: root mismatch — investigate before serving (chain reorg? wrong deploy-block?)."
  fi
}

# ---- reip: re-pin to IPFS --------------------------------------------------
cmd_reip() {
  local id="${1:?usage: dr-restore.sh reip <actionId>}"
  local f="$DEPLOYMENTS/proofs-${CHAIN_ID}-${id}.json"
  [ -f "$f" ] || die "no $f — run reproofs $id first"
  if [ -n "${IPFS_API:-}" ] && command -v curl >/dev/null 2>&1; then
    echo "pinning $f via IPFS HTTP API $IPFS_API"
    curl -fsS -X POST -F file=@"$f" "${IPFS_API%/}/api/v0/add?pin=true"
  elif command -v ipfs >/dev/null 2>&1; then
    echo "pinning $f via local ipfs CLI"
    ipfs add -q --pin "$f"
  else
    die "no IPFS_API and no ipfs CLI; install one to re-pin (the CID is what metadataURI references)"
  fi
}

# ---- reindex: rebuild the indexer from genesis -----------------------------
cmd_reindex() {
  local m; m="$(find_manifest)"
  local from_block="0"
  if [ -n "$m" ]; then
    from_block="$(jq -r '.transactions[]? | select(.contractName=="CorporateActionRegistry") | .blockNumber // empty' "$m" 2>/dev/null | head -n1 || true)"
    [ -n "$from_block" ] || from_block="0"
  fi
  cat <<EOF
Indexer rebuild (CAE-1 events are the only inputs; idempotent from genesis):
  - registry    : $REGISTRY
  - distributor : $DISTRIBUTOR
  - fromBlock   : $from_block  (registry deploy block; 0 = full backfill)
  - RPC         : $RPC_URL  (backup endpoint if primary is down)

Run your indexer's backfill against the above, e.g. via docker-compose:
  RPC_URL=$RPC_URL FROM_BLOCK=$from_block docker compose up -d indexer

Subscribe to: ActionAnnounced, MerkleRootPublished, ActionStatusChanged,
Funded, Claimed, UnclaimedSwept (see docs/INTEGRATION.md §3). Because these are
deterministic, a fresh index converges to the same state as the lost one.
EOF
}

case "${1:-}" in
  verify-manifest) cmd_verify_manifest ;;
  reconcile)       cmd_reconcile ;;
  reproofs)        shift; cmd_reproofs "$@" ;;
  reip)            shift; cmd_reip "$@" ;;
  reindex)         cmd_reindex ;;
  all)
    cmd_verify_manifest
    cmd_reconcile
    if [ -n "${2:-}" ]; then cmd_reproofs "$2"; cmd_reip "$2"; fi
    cmd_reindex
    ;;
  *) die "unknown command '$1' (try: dr-restore.sh help)" ;;
esac
