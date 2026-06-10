# CorporaX — Operator Runbook

> Operational procedures for deploying, running, and maintaining CorporaX on
> Robinhood Chain testnet (chainId 46630), Arbitrum Sepolia (421614), or local
> anvil (31337). Commands here are real and use this repo's tooling. Pair this
> with [INTEGRATION.md](./INTEGRATION.md) (canonical names/schemas) and
> [THREAT-MODEL.md](./THREAT-MODEL.md) (what each control defends).

**Package manager: `npm`** (this repo does not use pnpm). Requires
[Foundry](https://book.getfoundry.sh/) (`anvil`/`cast`/`forge`), Node ≥ 20, and `jq`.

---

## 0. Conventions

- All paths are relative to the repo root unless noted.
- Address registries live at `deployments/<chainId>.json`; proofs at `deployments/proofs-<chainId>-<actionId>.json`.
- **Never commit `.env`.** It is gitignored; `.env.example` is the template.
- Sub-shell `cd` is used inside the npm scripts; you generally drive everything from the root.

---

## 1. Environment setup

```bash
# 1. Install JS workspaces
npm install

# 2. Install Solidity deps (OZ etc.) and build
cd contracts && forge install && forge build && cd ..

# 3. Create your .env from the template
cp .env.example .env
$EDITOR .env
```

Fill `.env` per [INTEGRATION.md §9](./INTEGRATION.md). The variables that matter per task:

| Task | Required env |
|---|---|
| Deploy (any chain) | `PRIVATE_KEY`; optional `ADMIN_ADDRESS`, `ISSUER_ADDRESS`, `AUTO_ATTEST` |
| Deploy on REAL tokens | also `USDG_ADDRESS`, `TSLA_ADDRESS`, `AMZN_ADDRESS` (omit → mocks are deployed) |
| Verify | `ROBINHOOD_BLOCKSCOUT_API_URL`, `BLOCKSCOUT_API_KEY` (or `ARBISCAN_API_KEY` on Sepolia) |
| Snapshot CLI | `RPC_URL` (read endpoint) |
| Frontend | the `NEXT_PUBLIC_*` set + server-only `ALCHEMY_API_KEY` |

**Sanity check before anything else:**

```bash
npm run test:contracts          # expect: 42 tests passed
cast chain-id --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"   # expect: 46630
cast balance <your-addr> --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"  # need gas
```

---

## 2. Faucets (testnet)

| What | Where / how | Notes |
|---|---|---|
| Robinhood Chain gas (ETH) | Robinhood Chain testnet faucet | ~0.05 ETH / 24h. Claim ahead of demo day. |
| Stock tokens (TSLA/AMZN/…) | Robinhood Chain stock-token faucet | ~5 units per token / 24h. Used to seed holder balances on REAL tokens. |
| USDG | Paxos testnet faucet ("Send 100 Tokens") | Fund the **issuer** wallet; this is what gets distributed. |

If USDG is tight for a large demo, lower `ratePerShare` (e.g. `0.05e18`). The figures are demo-cosmetic; the mechanism is what's evaluated.

> **Fallback (Decision Gate G1):** if Robinhood Chain faucets/RPC are unstable, deploy to **Arbitrum Sepolia** with **mock tokens** (omit the `*_ADDRESS` envs). The contracts and procedures are identical.

---

## 3. Deploy

`Deploy.s.sol` deploys `AdminActionSource → CorporateActionRegistry → DividendDistributor`, wires `DISTRIBUTOR_ROLE` to the distributor, onboards the issuer for TSLA/AMZN (when admin == deployer), and writes `deployments/<chainId>.json`. Tokens are **REAL** when their `*_ADDRESS` env is set, otherwise a `MockERC20` faucet is deployed.

### 3.1 Local (anvil)

```bash
npm run anvil          # terminal A: 127.0.0.1:8545, chainId 31337
# terminal B:
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # anvil #0
npm run deploy:local   # → deployments/31337.json
```

### 3.2 Robinhood Chain testnet (REAL tokens)

```bash
export PRIVATE_KEY=<deployer key>
export ADMIN_ADDRESS=<governance multisig>     # SHOULD be a multisig (see §8)
export ISSUER_ADDRESS=<issuer ops wallet>
export AUTO_ATTEST=false                        # production posture: require attestations
export USDG_ADDRESS=<real USDG>
export TSLA_ADDRESS=<real TSLA>
export AMZN_ADDRESS=<real AMZN>

cd contracts && forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" \
  --broadcast --slow
cd ..
```

After deploy, record the addresses (printed and written to `deployments/46630.json`) into the root README's testnet table.

> On Arbitrum Sepolia, swap the RPC for `$ARBITRUM_SEPOLIA_RPC_URL`; chainId 421614 routes the deployment file accordingly.

### 3.3 Verify on Blockscout

Both core contracts MUST be source-verified.

```bash
cd contracts
forge verify-contract <REGISTRY_ADDR> src/CorporateActionRegistry.sol:CorporateActionRegistry \
  --chain-id 46630 \
  --verifier blockscout \
  --verifier-url "$ROBINHOOD_BLOCKSCOUT_API_URL" \
  --constructor-args $(cast abi-encode "constructor(address,address)" <ADMIN_ADDR> <SOURCE_ADDR>)

forge verify-contract <DISTRIBUTOR_ADDR> src/DividendDistributor.sol:DividendDistributor \
  --chain-id 46630 \
  --verifier blockscout \
  --verifier-url "$ROBINHOOD_BLOCKSCOUT_API_URL" \
  --constructor-args $(cast abi-encode "constructor(address,address)" <REGISTRY_ADDR> <ADMIN_ADDR>)
cd ..
```

Confirm the green "Verified" badge on `explorer.testnet.chain.robinhood.com`. On Sepolia use `--verifier etherscan --etherscan-api-key "$ARBISCAN_API_KEY"`.

Deterministic, reproducible bytecode is on by default (`bytecode_hash = none`, `cbor_metadata = false` in `foundry.toml`), so verification is stable.

---

## 4. Onboard an issuer (admin)

Each tokenized stock must have its issuer assigned before that issuer can announce actions. `Deploy.s.sol` does this for TSLA/AMZN when `admin == deployer`; otherwise the admin runs it explicitly:

```bash
cast send <REGISTRY_ADDR> 'setAssetIssuer(address,address)' <ASSET> <ISSUER> \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --private-key <ADMIN_KEY>
# verify
cast call <REGISTRY_ADDR> 'assetIssuer(address)(address)' <ASSET> --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
```

If `AUTO_ATTEST=false`, the issuer's announcement must first be attested on the `AdminActionSource` (see §5, step 1b).

---

## 5. Full lifecycle: announce → snapshot → publish → fund → claim

This is the production path using the snapshot CLI against **real `Transfer` logs**. (For a quick demo state on **mock** tokens, `npm run seed:local` does steps 1–4 in one command; see §6.)

Let `REG`, `DIST`, `ASSET`, `USDG` be the addresses from `deployments/<chainId>.json`.

### Step 1 — Announce (issuer)

Pick a `recordBlock` a few minutes in the future, a `payableAt`, and an optional `claimDeadline`.

```bash
NOW=$(date +%s)
RECORD_BLOCK=$(( $(cast block-number --rpc-url "$RPC_URL") + 30 ))   # ~ short window
RATE=500000000000000000        # 0.5 USDG/share (1e18 scale)
PAYABLE_AT=$NOW
DEADLINE=$(( NOW + 604800 ))   # +7 days; 0 for no deadline

cast send "$REG" \
  'announceAction(address,uint8,uint256,uint64,uint64,uint64,address,string)' \
  "$ASSET" 0 "$RATE" "$RECORD_BLOCK" "$PAYABLE_AT" "$DEADLINE" "$USDG" \
  "ipfs://corporax/tsla-q2-2026.json" \
  --rpc-url "$RPC_URL" --private-key <ISSUER_KEY>
# actionType 0 = CASH_DIVIDEND. Note the emitted `id` (first action = 1).
```

> **Step 1b (only if `AUTO_ATTEST=false`):** the announcement reverts unless the data hash is attested first. Compute it the same way the registry does and attest on the source:
> ```bash
> HASH=$(cast keccak $(cast abi-encode \
>   "f(address,uint8,uint256,uint64,uint64,uint64,address,string)" \
>   "$ASSET" 0 "$RATE" "$RECORD_BLOCK" "$PAYABLE_AT" "$DEADLINE" "$USDG" "ipfs://corporax/tsla-q2-2026.json"))
> cast send <SOURCE_ADDR> 'attest(address,bytes32)' "$ASSET" "$HASH" \
>   --rpc-url "$RPC_URL" --private-key <ATTESTER_KEY>
> ```

### Step 2 — Snapshot (CLI), after the record block passes

Wait until `block.number > recordBlock`, then reconstruct balances and build the root:

```bash
export RPC_URL=<read endpoint>
ID=1                 # the action id emitted by announceAction in Step 1
DEPLOY_BLOCK=0       # the asset token's deploy block (scan lower bound)
npm run snapshot -- snapshot \
  --token "$ASSET" \
  --deploy-block "$DEPLOY_BLOCK" \
  --record-block "$RECORD_BLOCK" \
  --rate "$RATE" \
  --action-id "$ID" \
  --payout-token "$USDG" \
  --out "deployments/proofs-<chainId>-<id>.json"
```

`--token`, `--deploy-block`, `--record-block`, `--rate`, `--action-id` and `--out` are required; `--deploy-block` is the token's deploy block (the lower bound of the `Transfer` scan). Optional: `--rpc <url>` (overrides `$RPC_URL`), `--chunk <n>` (eth_getLogs page size, default 5000), `--payout-token <addr>` and `--chain-id <n>` (defaults to the RPC's reported id). This reads `Transfer` logs from `deployBlock` up to `recordBlock`, computes `amount = balance * rate / 1e18` per holder, builds the `StandardMerkleTree`, and writes the canonical `corporax-merkle-v1` artifact. It prints `merkleRoot`, `totalPayout`, and `holderCount` to stderr; the artifact path goes to stdout.

> **Path note:** `npm run snapshot` invokes the CLI from the `tooling/snapshot/` workspace, so any **relative** `--out`/`verify` path resolves against that directory, not the repo root. Use an **absolute** path (or run the binary directly from the repo root, e.g. `node tooling/snapshot/dist/cli.js snapshot --out deployments/...`) so the artifact lands in `deployments/`.

**Verify determinism (recommended):** re-run and confirm an identical root, or use the CLI's verify mode, which re-derives the root, re-checks every proof, and asserts `Σ amount == totalPayout` (exits non-zero on any mismatch — `verify` takes the artifact path as a positional argument):

```bash
npm run snapshot -- verify "deployments/proofs-<chainId>-<id>.json"
```

### Step 3 — Publish the root (issuer)

```bash
cast send "$REG" 'publishRoot(uint256,bytes32,uint256,uint256)' \
  <id> <merkleRoot> <totalPayout> <holderCount> \
  --rpc-url "$RPC_URL" --private-key <ISSUER_KEY>
# reverts RecordNotTaken unless block.number > recordBlock
```

### Step 4 — Fund (issuer)

Approve, then fund the exact `totalPayout`. On full funding the action auto-flips to `CLAIMABLE`.

```bash
cast send "$USDG" 'approve(address,uint256)' "$DIST" <totalPayout> \
  --rpc-url "$RPC_URL" --private-key <ISSUER_KEY>
cast send "$DIST" 'fund(uint256,uint256)' <id> <totalPayout> \
  --rpc-url "$RPC_URL" --private-key <ISSUER_KEY>
# confirm:
cast call "$REG" 'actionView(uint256)' <id> --rpc-url "$RPC_URL"   # status field == 2 (CLAIMABLE)
```

> Funding more than `totalPayout` reverts `Overfunded`. You may fund in multiple partial transfers; the flip happens on the call that reaches the total.

### Step 5 — Claim (anyone, on behalf of `account`)

Pull `index`/`amount`/`proof` from the proofs file (keyed by **lowercase** address):

```bash
H=<holder addr>
INDEX=$(jq -r ".claims[\"${H,,}\"].index"  deployments/proofs-<chainId>-<id>.json)
AMOUNT=$(jq -r ".claims[\"${H,,}\"].amount" deployments/proofs-<chainId>-<id>.json)
PROOF=$(jq -r ".claims[\"${H,,}\"].proof | join(\",\")" deployments/proofs-<chainId>-<id>.json)

cast send "$DIST" 'claim(uint256,uint256,address,uint256,bytes32[])' \
  <id> "$INDEX" "$H" "$AMOUNT" "[$PROOF]" \
  --rpc-url "$RPC_URL" --private-key <ANY_KEY>      # funds always go to $H

cast call "$USDG" 'balanceOf(address)(uint256)' "$H" --rpc-url "$RPC_URL"
```

In production this `claim` is what the gasless relayer / paymaster submits on the holder's behalf — the contract is indifferent to the submitter, and the USDG always settles to `account`.

---

## 6. One-command demo state (mock tokens)

For local/Sepolia mock deployments, `Seed.s.sol` mints to two demo holders, announces, publishes, and funds a TSLA dividend to `CLAIMABLE`, and writes `proofs.json` — bypassing the snapshot CLI by computing the root in Solidity over a known holder set.

```bash
export PRIVATE_KEY=<issuer/admin key>   # default holders = anvil #1, #2; override with DEMO_HOLDER_1/2
npm run seed:local                       # → deployments/proofs-31337-1.json
```

> Requires the tokens in the deployment file to be `MockERC20` (it calls `mint`). Do **not** run against real tokens. Re-running rebuilds clean demo state in well under five minutes for a re-record.

---

## 7. Sweep unclaimed (issuer)

After `claimDeadline`, the issuer reclaims the unclaimed remainder (`funded − claimed`). This also finalizes the action.

```bash
cast send "$DIST" 'sweepUnclaimed(uint256)' <id> \
  --rpc-url "$RPC_URL" --private-key <ISSUER_KEY>
# reverts SweepNotAllowed before the deadline, or if claimDeadline == 0
# reverts Unauthorized unless caller == issuer for the asset
```

The contract finalizes (`markFinalized`) **before** transferring, and claims require `CLAIMABLE`, so no claim can race the sweep. Confirm `status == 3` (FINALIZED) afterward.

---

## 8. Key management & rotation

| Key | Role | Custody (target) |
|---|---|---|
| Deployer | one-time deploy broadcaster | dedicated low-value testnet key; HSM/keystore in prod |
| Admin (`DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE`) | onboard issuers, swap source, pause | **multisig** (e.g. Safe) in production |
| Issuer (per asset) | announce/publish/fund/sweep | issuer ops wallet; rotate via admin |
| Attester (`ATTESTER_ROLE` on source) | vouch announcements | issuer/registrar control |

**Rotate an issuer** (admin): `setAssetIssuer(asset, newIssuer)` — instantly re-scopes all future operations for that asset; in-flight actions remain valid and continue to be managed by the new issuer.

**Rotate the admin** (use OZ `AccessControl`): grant the role to the new admin, then renounce from the old.

```bash
cast send "$REG" 'grantRole(bytes32,address)' $(cast call "$REG" 'DEFAULT_ADMIN_ROLE()(bytes32)' --rpc-url "$RPC_URL") <NEW_ADMIN> --rpc-url "$RPC_URL" --private-key <OLD_ADMIN_KEY>
cast send "$REG" 'renounceRole(bytes32,address)' $(cast call "$REG" 'DEFAULT_ADMIN_ROLE()(bytes32)' --rpc-url "$RPC_URL") <OLD_ADMIN> --rpc-url "$RPC_URL" --private-key <OLD_ADMIN_KEY>
# repeat PAUSER_ROLE on both REG and DIST; do the same for DIST's DEFAULT_ADMIN_ROLE.
```

> Rotate roles on **both** the registry and the distributor — they have independent `AccessControl`. Never renounce the new admin before confirming the grant.

---

## 9. Pause / emergency procedures

Both core contracts are `Pausable`; `PAUSER_ROLE` (the admin) controls them independently.

```bash
# Halt issuer ops on the registry (announce/publishRoot):
cast send "$REG"  'pause()'   --rpc-url "$RPC_URL" --private-key <PAUSER_KEY>
# Halt fund + claim on the distributor:
cast send "$DIST" 'pause()'   --rpc-url "$RPC_URL" --private-key <PAUSER_KEY>
# Resume:
cast send "$DIST" 'unpause()' --rpc-url "$RPC_URL" --private-key <PAUSER_KEY>
cast send "$REG"  'unpause()' --rpc-url "$RPC_URL" --private-key <PAUSER_KEY>
```

When to pause:

- **Distributor pause** — suspected invalid root/proof in the wild, a token integration anomaly, or a discovered claim issue. Stops claims and further funding **without redirecting any funds** (custody is untouched; pause is a halt, not a withdrawal).
- **Registry pause** — suspected oracle/source compromise; blocks new announcements and root publishing while you investigate.

`sweepUnclaimed` is intentionally **not** gated by `whenNotPaused`, so an issuer can still reclaim their own funds after the deadline even during a pause. There is no admin withdrawal of holder funds by design.

---

## 10. Cancel an action (issuer)

Before any value moves, the issuer may cancel:

```bash
cast send "$REG" 'cancelAction(uint256)' <id> --rpc-url "$RPC_URL" --private-key <ISSUER_KEY>
# valid only while status is ANNOUNCED or ROOT_PUBLISHED; reverts InvalidStatus once CLAIMABLE
```

There is deliberately no cancel after `CLAIMABLE` — once holders can claim, only the post-deadline sweep returns the remainder.

---

## 11. On-call checklist

**Daily / pre-demo:**

- [ ] `npm run test:contracts` is green (42 tests).
- [ ] Both contracts show "Verified" on Blockscout.
- [ ] Deployer/issuer wallets have gas; issuer holds enough USDG for any pending `fund`.
- [ ] `deployments/<chainId>.json` and committed `proofs-*.json` match on-chain state.
- [ ] RPC endpoint responds (`cast chain-id`) and is not rate-limited.

**Per corporate action:**

- [ ] `recordBlock` is in the future at announce; snapshot taken only after it passes.
- [ ] Root reproduced independently (re-run snapshot → identical root).
- [ ] `totalPayout` funded exactly; status confirmed `CLAIMABLE`.
- [ ] At least two real claims succeed end-to-end and balances reconcile vs. `proofs.json`.

**Incident triage:**

1. **Claims failing / suspicious proof** → `pause()` the distributor; reproduce the root; compare against the published root; resume or re-issue.
2. **Bad announcement** → if not yet `CLAIMABLE`, `cancelAction`; investigate the source/attester.
3. **Oracle/source concern** → `pause()` the registry; consider `setActionSource` to a known-good source.
4. **Funds discrepancy** → check the solvency invariant on-chain: `usdg.balanceOf(distributor) == totalFunded(id) − totalClaimed(id)` for each live action. A mismatch is a P0 incident.
5. Capture tx hashes and the `deployments/` snapshot; do not rotate keys mid-incident unless a key is the suspected cause.

---

## 12. Quick reference — addresses & status codes

- Address registry: `deployments/<chainId>.json` (`registry`, `distributor`, `actionSource`, `usdg`, `tsla`, `amzn`, `admin`, `issuer`).
- `ActionType`: `0=CASH_DIVIDEND, 1=STOCK_SPLIT, 2=STOCK_DIVIDEND`.
- `ActionStatus`: `0=ANNOUNCED, 1=ROOT_PUBLISHED, 2=CLAIMABLE, 3=FINALIZED, 4=CANCELLED`.
