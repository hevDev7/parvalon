# Parvalon — Production Deploy Story

> End-to-end: **deploy → verify → governance handover → swap to the production
> action source → monitor → onboard issuers.** Every command is real and uses
> this repo's scripts. Pair with [INTEGRATION.md](./INTEGRATION.md) (frozen
> names/schemas), [RUNBOOK.md](./RUNBOOK.md) (day-2 ops), [DR.md](./DR.md)
> (recovery), [KEY-MANAGEMENT.md](./KEY-MANAGEMENT.md) (custody) and
> [MULTICHAIN.md](./MULTICHAIN.md) (per-chain layout).

**Tooling:** [Foundry](https://book.getfoundry.sh/) (`forge`/`cast`), Node ≥ 20,
`jq`. Package manager is **npm** (not pnpm). Targets in [§8 of INTEGRATION](./INTEGRATION.md#8-chains):
Robinhood Chain testnet (46630, primary), Arbitrum Sepolia (421614, fallback),
local anvil (31337).

---

## 0. Pre-flight

```bash
cp .env.example .env && $EDITOR .env          # fill per INTEGRATION §9
npm install
npm run test:contracts                         # expect: all green
cast chain-id --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"   # expect 46630
cast balance "$(cast wallet address --private-key "$PRIVATE_KEY")" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
```

Custody: the deployer key should come from a keystore/HSM, **never** a plaintext
`.env` in production. See [KEY-MANAGEMENT.md](./KEY-MANAGEMENT.md) for the AWS/GCP
KMS path (`cast --aws` / KMS signer). The flow below shows `--private-key` for
readability; substitute `--account <keystore>` or the KMS signer in production.

---

## 1. Deploy + verify (reproducible)

One command pins the toolchain, deploys `Deploy.s.sol` with `--verify`, and writes
a **signed** manifest (addresses + tx hashes + commit sha + compiler):

```bash
# Robinhood Chain (Blockscout verification)
scripts/deploy-and-verify.sh robinhood_testnet

# Arbitrum Sepolia fallback (Arbiscan verification)
scripts/deploy-and-verify.sh arbitrum_sepolia

# Commit the manifest in the same step:
COMMIT_MANIFEST=true scripts/deploy-and-verify.sh robinhood_testnet
```

Outputs:
- `deployments/<chainId>.json` — the address registry ([INTEGRATION §6](./INTEGRATION.md#6-deploymentschainidjson-schema)).
- `deployments/manifests/<network>-<chainId>.json` — signed provenance:
  `compiler{solc,forge,bytecodeHash:none,optimizerRuns:200}`, per-contract tx
  hashes, `commitSha`, and a `provenance{bodyKeccak,signer,signature}` block.

Verify a manifest later (no chain access needed):

```bash
M=deployments/manifests/robinhood_testnet-46630.json
cast wallet verify --address "$(jq -er .provenance.signer $M)" \
  "$(jq -er .provenance.bodyKeccak $M)" "$(jq -er .provenance.signature $M)"
```

`Deploy.s.sol` deploys: `AdminActionSource` (open testnet attestor),
`CorporateActionRegistry`, `DividendDistributor`, grants the distributor
`DISTRIBUTOR_ROLE`, and (when admin == deployer) onboards the issuer for TSLA/AMZN.
On REAL chains pass `USDG_ADDRESS/TSLA_ADDRESS/AMZN_ADDRESS`; omit them on
Sepolia/local to deploy `MockERC20` faucets.

**Idempotency:** re-running on the same commit + chain reuses forge's broadcast
cache; the manifest is regenerated deterministically and overwritten. For a fresh
deploy, bump the commit (or clean `contracts/broadcast/`).

---

## 2. Governance handover (P0-1/P0-2)

While the deployer still holds admin, hand the protocol to a Safe + timelock and
have the deployer renounce. This is `DeployGovernance.s.sol`:

```bash
SAFE_ADDRESS=0xYourGnosisSafe \
TIMELOCK_MIN_DELAY=172800 \
forge script script/Deploy*/../DeployGovernance.s.sol:DeployGovernance \
  --root contracts --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --broadcast
```

(Equivalently: `cd contracts && forge script script/DeployGovernance.s.sol:DeployGovernance --rpc-url … --broadcast`.)

Result — written to `deployments/governance-<chainId>.json`:
- `DEFAULT_ADMIN_ROLE` on both contracts → the **TimelockController** (slow,
  observable privilege changes proposed/executed by the Safe).
- `PAUSER_ROLE` → the **Safe** directly (fast emergency stop).
- The deployer **renounces** admin + pauser on both contracts. No EOA retains power.

After this point every admin action (issuer onboarding, action-source swap,
config) goes through the timelock; pause/unpause goes through the Safe. The
scripts in §4–§6 auto-detect this and print the calldata to submit.

---

## 3. Swap to FunctionsActionSource (P0-4)

Promote the open-testnet `AdminActionSource` to the production
**Chainlink Functions** attestor. Deploy it first:

```bash
# In contracts/. Reads registry from deployments/<chainId>.json.
FUNCTIONS_ROUTER=0xRouter \
FUNCTIONS_SUBSCRIPTION=42 \
FUNCTIONS_DON_ID=0x66756e2d... \
FUNCTIONS_GAS_LIMIT=300000 \
ADMIN_ADDRESS=0xTimelock \
SWAP=false \
forge script script/DeployFunctionsSource.s.sol:DeployFunctionsSource \
  --root contracts --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --broadcast
```

This writes `deployments/functions-source-<chainId>.json` and, because
`SWAP=false`, **prints the exact `setActionSource(<addr>)` calldata** to schedule
through the timelock. (Before governance handover you may set `SWAP=true` to swap
atomically; the script reverts with a clear message if the broadcaster lacks
`DEFAULT_ADMIN_ROLE`.)

Then, governed swap via the timelock/Safe:

```bash
# 1. Configure the Functions request + DON config on the new source (admin only):
#    setRequestData(<cbor>), setConfig(subId, donId, gasLimit)  — via timelock.
# 2. Schedule + execute registry.setActionSource(<functionsSource>) via timelock.
#    The calldata is printed by DeployFunctionsSource; or build it with:
cast calldata 'setActionSource(address)' 0xFunctionsSource
# Confirm:
cast call <registry> 'actionSource()(address)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
```

The indexer/ops always read `registry.actionSource()` on-chain — the
`functions-source-*.json` artifact is provenance, not source of truth.

---

## 4. Monitor

Bring up monitoring (see `infra/` + `docker-compose.yml`) and subscribe to the
CAE-1 events in [INTEGRATION §3](./INTEGRATION.md#3-cae-1-event-schema-subscribe-to-these):
`ActionAnnounced`, `MerkleRootPublished`, `ActionStatusChanged`, `Funded`,
`Claimed`, `UnclaimedSwept`. Spot-check live state any time:

```bash
RPC_URL="$ROBINHOOD_TESTNET_RPC_URL" scripts/dr-restore.sh reconcile
```

Pre-stage the emergency drills so responders have muscle memory
([§Drills in RUNBOOK](./RUNBOOK.md)):

```bash
RPC_URL="$ROBINHOOD_TESTNET_RPC_URL" scripts/drills.sh status
# Post-handover the Safe runs pause via:
forge script script/Drills.s.sol:Drills --sig "pauseDryRun()" --root contracts --rpc-url "$RPC_URL"
```

---

## 5. Onboard issuers (P1-9)

Authorize each asset's transfer-agent ops account:

```bash
RPC_URL="$ROBINHOOD_TESTNET_RPC_URL" scripts/onboard-issuer.sh <asset> <issuer>
```

- **Pre-handover** (EOA admin): the script sends `setAssetIssuer` and verifies it.
- **Post-handover** (timelock admin): the script prints the timelock
  `schedule(...)` + `execute(...)` calldata for the Safe. Full walkthrough in
  [ONBOARDING.md](./ONBOARDING.md).

---

## 6. Steady state

| Concern | Where |
|---|---|
| Announce → snapshot → publish → fund → claim | [RUNBOOK.md](./RUNBOOK.md) |
| Pause / unpause / issuer rotation drills | `scripts/drills.sh`, `script/Drills.s.sol` |
| Per-chain deploy + registry layout | [MULTICHAIN.md](./MULTICHAIN.md) |
| Key custody (HSM/KMS), audit logging | [KEY-MANAGEMENT.md](./KEY-MANAGEMENT.md) |
| Recovery from on-chain state | [DR.md](./DR.md), `scripts/dr-restore.sh` |

---

## Deploy checklist

- [ ] `npm run test:contracts` green; `forge --version` matches the pin.
- [ ] `.env` filled; deployer funded; admin/issuer/Safe addresses confirmed.
- [ ] `scripts/deploy-and-verify.sh <network>` — contracts verified on the explorer.
- [ ] Signed manifest committed (`COMMIT_MANIFEST=true`) and signature re-verified.
- [ ] `DeployGovernance.s.sol` run; deployer renounced admin + pauser; Safe/timelock recorded.
- [ ] `DeployFunctionsSource.s.sol` deployed; request/config set; `setActionSource` scheduled+executed; `actionSource()` confirms.
- [ ] Monitoring live; CAE-1 events flowing; `dr-restore.sh reconcile` clean.
- [ ] Issuers onboarded per asset; `assetIssuer(asset)` confirmed.
