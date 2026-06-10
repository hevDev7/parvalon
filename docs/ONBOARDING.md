# CorporaX — Issuer Onboarding (P1-9)

> How to authorize an asset's **issuer** (transfer-agent ops account) and the
> mechanics of `scripts/onboard-issuer.sh`. Pair with [DEPLOY.md](./DEPLOY.md),
> [RUNBOOK.md](./RUNBOOK.md), and [KEY-MANAGEMENT.md](./KEY-MANAGEMENT.md).

---

## 1. What "onboarding an issuer" means

For each tokenized asset, the registry stores one **issuer** address:

```
registry.assetIssuer(asset) -> address
registry.setAssetIssuer(asset, issuer)   // DEFAULT_ADMIN_ROLE only
```

The issuer is the account permitted to drive that asset's dividend lifecycle —
specifically `DividendDistributor.fund(id, amount)` and `sweepUnclaimed(id)` for
actions on that asset. **Announcing** and **publishing the root** are also issuer
operations. The issuer never custodies user funds: `claim` is claim-on-behalf and
always pays the holder's `account` ([INTEGRATION §2](./INTEGRATION.md#2-contracts-the-frozen-api)).

Onboarding is therefore a single privileged write — but *who* signs it depends on
whether governance has been handed over.

---

## 2. Two paths (auto-detected)

`scripts/onboard-issuer.sh <asset> <issuer>` inspects who holds
`DEFAULT_ADMIN_ROLE` on the registry and picks:

### DIRECT — admin is an EOA (pre-handover, or dev)
The signer in `PRIVATE_KEY` *is* the admin. The script:
1. Verifies the signer holds `DEFAULT_ADMIN_ROLE`.
2. Sends `setAssetIssuer(asset, issuer)`.
3. Re-reads `assetIssuer(asset)` and asserts it equals `issuer`.

```bash
RPC_URL="$ROBINHOOD_TESTNET_RPC_URL" \
PRIVATE_KEY="$ADMIN_KEY" \
scripts/onboard-issuer.sh 0xTSLA 0xIssuerOps
# -> OK: issuer for 0xTSLA is now 0xIssuerOps
```

### GOVERNED — admin is the TimelockController (post-handover)
After [DeployGovernance](./DEPLOY.md#2-governance-handover-p0-1p0-2) the admin is
the timelock and the Safe is its proposer/executor. No EOA can write directly, so
the script **prints the calldata** to submit through the Safe — it broadcasts
nothing:

```bash
RPC_URL="$ROBINHOOD_TESTNET_RPC_URL" scripts/onboard-issuer.sh 0xTSLA 0xIssuerOps
```

Output (abridged):

```
GOVERNED: registry admin is the timelock 0xTimelock
  operationId : 0x…
  inner call  : registry.setAssetIssuer(0xTSLA, 0xIssuerOps)

  STEP 1 — schedule   (Safe -> timelock 0xTimelock)
    to   : 0xTimelock
    data : 0x01d5062a…           # schedule(target,value,data,predecessor,salt,delay)

  ... wait >= 172800 seconds (timelock min delay) ...

  STEP 2 — execute    (Safe -> timelock 0xTimelock)
    to   : 0xTimelock
    data : 0x134008d3…           # execute(target,value,data,predecessor,salt)
```

The Safe signers submit **STEP 1** now, wait out the timelock `minDelay`, then
submit **STEP 2**. Track readiness:

```bash
cast call 0xTimelock 'isOperationReady(bytes32)(bool)' 0x<operationId> --rpc-url "$RPC_URL"
```

The timelock address is read from `deployments/governance-<chainId>.json`
(`.timelock`) or `TIMELOCK_ADDRESS`. The delay defaults to the timelock's
`getMinDelay()`; the salt defaults to `0x0…0` (override with `TIMELOCK_SALT` if
you need to schedule the same call twice).

---

## 3. Environment

| Var | When | Meaning |
|---|---|---|
| `RPC_URL` | always | target RPC (e.g. `$ROBINHOOD_TESTNET_RPC_URL`) |
| `PRIVATE_KEY` | DIRECT path | admin signer (use a keystore/KMS in prod — see [KEY-MANAGEMENT.md](./KEY-MANAGEMENT.md)) |
| `REGISTRY_ADDRESS` | optional | override; else `deployments/<chainId>.json .registry` |
| `TIMELOCK_ADDRESS` | optional | override; else `deployments/governance-<chainId>.json .timelock` |
| `TIMELOCK_DELAY` | optional | seconds for `schedule()` (default: `getMinDelay()`) |
| `TIMELOCK_SALT` | optional | `bytes32` salt for schedule/execute |

---

## 4. Choosing the issuer address

- Prefer a **dedicated ops account or a per-asset Safe**, not a personal EOA.
  Custody and rotation policy live in [KEY-MANAGEMENT.md](./KEY-MANAGEMENT.md).
- The issuer key signs `fund`/`sweep` and funds dividends — keep it KMS/HSM-backed.
- **Rotation** (e.g. suspected key compromise) is just another `setAssetIssuer`:
  use the emergency drill `scripts/drills.sh rotate-issuer <asset> <newIssuer>`
  (DIRECT) or `Drills.s.sol --sig rotateIssuerDryRun()` for the governed calldata.
  Rotation takes effect for *future* funding; in-flight escrow already belongs to
  the distributor and is unaffected.

---

## 5. Verification & rollback

```bash
# Confirm
cast call <registry> 'assetIssuer(address)(address)' <asset> --rpc-url "$RPC_URL"
```

- DIRECT path self-verifies (the script asserts and exits non-zero on mismatch).
- GOVERNED path: after STEP 2 executes, re-run the `assetIssuer` call above.
- **Rollback** is symmetric: `setAssetIssuer(asset, previousIssuer)` (DIRECT) or
  re-schedule via the timelock. There is no destructive state — only the single
  authorized-issuer pointer changes.

---

## 6. Onboarding checklist

- [ ] Asset address confirmed (the tokenized stock, e.g. TSLA on the target chain).
- [ ] Issuer address is a dedicated, KMS/HSM-backed ops account / Safe.
- [ ] Correct path: DIRECT (EOA admin) vs GOVERNED (timelock admin).
- [ ] DIRECT: `assetIssuer(asset) == issuer` after the tx (script asserts this).
- [ ] GOVERNED: schedule submitted, `minDelay` elapsed, execute submitted, then verify.
- [ ] Issuer funded with gas + the payout token before its first `fund(id, amount)`.
