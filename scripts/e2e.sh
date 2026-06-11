#!/usr/bin/env bash
# ============================================================================
# Live protocol end-to-end test.
#   anvil -> deploy -> seed -> claim -> CLI snapshot parity -> monitor solvency
# Asserts the holder receives the EXACT pro-rata payout, the production snapshot
# CLI reproduces the on-chain Merkle root, and the monitor reports solvent.
# Exits non-zero on any failure. Used by .github/workflows/e2e.yml and runnable
# locally:  bash scripts/e2e.sh   (requires nothing already bound to :8545)
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC="${RPC_URL:-http://127.0.0.1:8545}"
MNEMONIC="test test test test test test test test test test test junk"

fail() {
  echo "❌ $1" >&2
  exit 1
}
ok() { echo "✓ $1"; }

# --- 0. preflight -----------------------------------------------------------
for bin in anvil cast forge jq node python3; do
  command -v "$bin" >/dev/null 2>&1 || fail "missing required tool: $bin"
done
if cast block-number --rpc-url "$RPC" >/dev/null 2>&1; then
  fail "something is already listening on $RPC — stop it before running the E2E"
fi

# --- 1. anvil ---------------------------------------------------------------
echo "▸ starting anvil"
anvil --silent >/tmp/e2e-anvil.log 2>&1 &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do cast block-number --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done
cast block-number --rpc-url "$RPC" >/dev/null 2>&1 || fail "anvil did not start"
ok "anvil up"

export PRIVATE_KEY
PRIVATE_KEY="$(cast wallet private-key --mnemonic "$MNEMONIC")"

# --- 2. deploy + seed -------------------------------------------------------
echo "▸ deploy + seed"
(cd "$ROOT/contracts" && forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC" --broadcast) \
  >/tmp/e2e-deploy.log 2>&1 || {
  cat /tmp/e2e-deploy.log
  fail "deploy failed"
}
(cd "$ROOT/contracts" && forge script script/Seed.s.sol:Seed --rpc-url "$RPC" --broadcast) \
  >/tmp/e2e-seed.log 2>&1 || {
  cat /tmp/e2e-seed.log
  fail "seed failed"
}
grep -q "Seeded CLAIMABLE" /tmp/e2e-seed.log || fail "seed did not reach CLAIMABLE"
ok "deployed + seeded (action 1 CLAIMABLE)"

DEP="$ROOT/deployments/31337.json"
PROOFS="$ROOT/deployments/proofs-31337-1.json"
REG=$(jq -r .registry "$DEP")
DIST=$(jq -r .distributor "$DEP")
TSLA=$(jq -r .tsla "$DEP")
USDG=$(jq -r .usdg "$DEP")

# --- 3. claim and assert the exact payout -----------------------------------
echo "▸ holder claim"
H=$(jq -r '.claims | to_entries[0].key' "$PROOFS")
IDX=$(jq -r '.claims | to_entries[0].value.index' "$PROOFS")
AMT=$(jq -r '.claims | to_entries[0].value.amount' "$PROOFS")
PROOF=$(jq -r '.claims | to_entries[0].value.proof | join(",")' "$PROOFS")

before=$(cast call "$USDG" 'balanceOf(address)(uint256)' "$H" --rpc-url "$RPC" | awk '{print $1}')
cast send "$DIST" 'claim(uint256,uint256,address,uint256,bytes32[])' \
  1 "$IDX" "$H" "$AMT" "[$PROOF]" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" >/dev/null
after=$(cast call "$USDG" 'balanceOf(address)(uint256)' "$H" --rpc-url "$RPC" | awk '{print $1}')
delta=$(python3 -c "print($after - $before)")
[ "$delta" = "$AMT" ] || fail "claim payout mismatch: got $delta, expected $AMT"
ok "holder received exactly $AMT (pro-rata)"

# --- 4. production CLI reproduces the on-chain root --------------------------
echo "▸ CLI snapshot parity + verify"
[ -f "$ROOT/tooling/snapshot/dist/cli.js" ] || (cd "$ROOT" && npm -w @corporax/snapshot run build >/dev/null 2>&1)
RB=$(cast block-number --rpc-url "$RPC")
seed_root=$(jq -r .merkleRoot "$PROOFS")
node "$ROOT/tooling/snapshot/dist/cli.js" snapshot \
  --rpc "$RPC" --token "$TSLA" --deploy-block 0 --record-block "$RB" \
  --rate 500000000000000000 --action-id 1 --payout-token "$USDG" \
  --out /tmp/e2e-cli-proofs.json >/dev/null 2>&1 || fail "CLI snapshot failed"
cli_root=$(jq -r .merkleRoot /tmp/e2e-cli-proofs.json)
[ "$cli_root" = "$seed_root" ] || fail "CLI root != on-chain root ($cli_root vs $seed_root)"
node "$ROOT/tooling/snapshot/dist/cli.js" verify /tmp/e2e-cli-proofs.json >/dev/null 2>&1 || fail "CLI verify failed"
ok "CLI reproduces on-chain root + verify OK"

# --- 5. monitor solvency check ----------------------------------------------
echo "▸ monitor solvency check"
[ -f "$ROOT/tooling/monitor/dist/cli.js" ] || (cd "$ROOT" && npm -w @corporax/monitor run build >/dev/null 2>&1)
RPC_URL="$RPC" node "$ROOT/tooling/monitor/dist/cli.js" check --rpc "$RPC" --chain-id 31337 >/dev/null 2>&1 \
  || fail "monitor reported a solvency/state violation"
ok "monitor: solvent"

echo "✅ E2E PASSED"
