# CorporaX — Disaster Recovery

> How to restore the **operational picture** purely from on-chain state plus
> committed artifacts — re-derive proofs, re-pin to IPFS, rebuild the indexer —
> plus the signer-loss playbook and backup RPC/indexer failover. Pairs with
> `scripts/dr-restore.sh`, [DEPLOY.md](./DEPLOY.md), [KEY-MANAGEMENT.md](./KEY-MANAGEMENT.md),
> [MULTICHAIN.md](./MULTICHAIN.md), [RUNBOOK.md](./RUNBOOK.md).

---

## 0. Recovery principle

**The chain is the source of truth.** No private database is load-bearing:

- Contract **addresses** → `deployments/<chainId>.json` (git) + signed manifest.
- **Action state** (announce/publish/fund/claim) → on-chain in registry +
  distributor; emitted as CAE-1 events ([INTEGRATION §3](./INTEGRATION.md#3-cae-1-event-schema-subscribe-to-these)).
- **Proofs** → *deterministically re-derivable* from on-chain `Transfer` logs at
  the action's `recordBlock` via the snapshot CLI ([INTEGRATION §4–5](./INTEGRATION.md#4-merkle-leaf-encoding-canonical--do-not-change)).
- **Provenance** → `deployments/manifests/*` (signed; verifiable offline).

So a total loss of servers, databases, and the indexer is recoverable as long as
(a) the chain is up and (b) the git repo (or its mirror) survives.

---

## 1. `scripts/dr-restore.sh` — the recovery toolkit

```bash
RPC_URL=<working-or-backup-rpc> scripts/dr-restore.sh <subcommand>
```

| Subcommand | What it restores |
|---|---|
| `verify-manifest` | Re-derive the manifest keccak and verify the deployer signature — confirms which contracts are authentic before trusting any address. |
| `reconcile` | Read live state (paused, `actionSource`, `actionCount`, per-action `totalFunded`/`totalClaimed`) → health report. |
| `reproofs <id>` | Re-run the snapshot CLI from on-chain logs to regenerate `proofs-<chainId>-<id>.json`; compare its root to the registry's published `merkleRoot`. |
| `reip <id>` | Re-pin the regenerated proofs to IPFS (the CID that `metadataURI` references). |
| `reindex` | Print the indexer backfill command (fromBlock = registry deploy block). |
| `all <id?>` | verify-manifest → reconcile → (reproofs+reip if `id`) → reindex. |

All subcommands are **read-only on-chain** (no `PRIVATE_KEY` needed) except `reip`
auth, which depends on your IPFS provider.

---

## 2. Scenario: indexer / database is gone

The indexer is a *cache* of CAE-1 events; rebuild it from genesis.

```bash
# 1. Confirm addresses are authentic.
RPC_URL="$ROBINHOOD_TESTNET_RPC_URL" scripts/dr-restore.sh verify-manifest

# 2. See live truth.
RPC_URL="$ROBINHOOD_TESTNET_RPC_URL" scripts/dr-restore.sh reconcile

# 3. Get the backfill command (fromBlock = registry deploy block, from the manifest).
RPC_URL="$ROBINHOOD_TESTNET_RPC_URL" scripts/dr-restore.sh reindex
# -> e.g.:  RPC_URL=… FROM_BLOCK=<deployBlock> docker compose up -d indexer
```

Because the six CAE-1 events fully describe lifecycle + funding + claims, a fresh
index **converges to the same state** as the one you lost. There is no
reconciliation step against a private DB — the events *are* the ledger.

---

## 3. Scenario: proofs / IPFS content is gone

Holder proofs are not unique secrets — they are a deterministic function of the
record-block holder set. Regenerate and re-pin:

```bash
# Re-derive proofs for action #1 straight from on-chain Transfer logs.
RPC_URL="$ROBINHOOD_TESTNET_RPC_URL" scripts/dr-restore.sh reproofs 1
#   reads asset/ratePerShare/recordBlock from registry.getAction(1)
#   runs: npm run snapshot -- snapshot --token … --record-block … --rate … --out deployments/proofs-46630-1.json
#   then asserts the regenerated merkleRoot == the on-chain published root

# Re-pin the regenerated file to IPFS (CCID that metadataURI points at).
IPFS_API=https://ipfs.internal:5001 \
RPC_URL="$ROBINHOOD_TESTNET_RPC_URL" scripts/dr-restore.sh reip 1
```

If the regenerated root matches the published `merkleRoot`, **every existing
claim proof is still valid** — the contract verifies against the same root, so
nothing on-chain changed. A mismatch means a wrong `--deploy-block` (set
`SNAPSHOT_DEPLOY_BLOCK`) or a chain reorg below the record block — investigate
before serving (see [INTEGRATION §4](./INTEGRATION.md#4-merkle-leaf-encoding-canonical--do-not-change)
for the exact leaf encoding the CLI must reproduce).

> Determinism guarantees: the CLI assigns leaf indices by ascending address and
> double-hashes per OZ `StandardMerkleTree`, identical to `Seed.s.sol`. Same
> inputs ⇒ byte-identical `proofs.json` ⇒ identical root.

---

## 4. Scenario: signer loss / compromise (playbook)

Loss or compromise of a privileged key. Severity depends on the key class
([KEY-MANAGEMENT §1](./KEY-MANAGEMENT.md#1-key-classes--blast-radius)).

### 4a. Relayer key (lowest severity)
Compromise = gas griefing only (claim-on-behalf always pays `account`). Steps:
1. **Disable** the KMS key (`aws kms disable-key`) — stops new signatures now.
2. Drain/cap the relayer balance; rotate to a new KMS key id; redeploy relayer config.
3. No on-chain change to CorporaX needed. Resume gasless claims.

### 4b. Issuer key
Can fund/sweep/announce for its asset; cannot touch user claims. Steps:
1. **Disable** the KMS key.
2. **Rotate the issuer** to a fresh ops account:
   - EOA admin: `scripts/drills.sh rotate-issuer <asset> <newIssuer>` (verifies).
   - Timelock admin: `forge script script/Drills.s.sol:Drills --sig "rotateIssuerDryRun()"`
     prints the `setAssetIssuer` calldata → schedule+execute via Safe/timelock
     ([ONBOARDING §2](./ONBOARDING.md#2-two-paths-auto-detected)).
3. If a malicious announce/publish happened, `cancelAction(id)` (admin) and, if
   funds were escrowed, `sweepUnclaimed` after the deadline. Pause first (§5).

### 4c. Admin / pauser (Safe owner) key
The timelock + Safe threshold are the safety net — one compromised owner key is
**not** enough to act. Steps:
1. If you suspect an in-flight malicious proposal, **pause** immediately via the
   Safe (`PAUSER_ROLE`) — see §5.
2. **Rotate the Safe owner set**: `removeOwner` the lost key, `addOwner` a fresh
   KMS-backed one (a Safe admin tx, itself timelocked if you route owner changes
   through governance).
3. Any pending timelock operation proposed by the attacker can be **cancelled**
   by the Safe before its `minDelay` elapses (`timelock.cancel(id)`) — this delay
   is the entire point of the handover design.
4. If the timelock key itself were lost (not just a Safe owner), admin power is
   frozen-safe: nothing new can be scheduled without the Safe, and existing roles
   keep working. Recover by the Safe scheduling a role re-grant to a new
   controller. Document in an incident report and re-verify the manifest signer.

> Never store the *only* copy of any signer outside the HSM/KMS. The whole design
> assumes keys are non-exportable and N-of-M; "signer loss" should mean "lost one
> of M", which is survivable by rotation, not "lost the protocol."

---

## 5. Emergency pause during recovery

Freeze the protocol while you investigate:

```bash
# EOA pauser (pre-handover / dev):
RPC_URL=<rpc> PRIVATE_KEY=<pauser> scripts/drills.sh pause-all      # verifies paused()
# ... investigate ...
RPC_URL=<rpc> PRIVATE_KEY=<pauser> scripts/drills.sh unpause-all

# Safe pauser (post-handover): get calldata, submit via Safe:
forge script script/Drills.s.sol:Drills --sig "pauseDryRun()" --root contracts --rpc-url <rpc>
```

Pause stops new announcements and **claims/funding**; it does not freeze funds
already escrowed in the distributor.

---

## 6. Backup RPC / indexer failover

**RPC.** Every recovery command takes `RPC_URL`; point it at a backup endpoint on
primary-RPC loss. The per-chain env var is in
[MULTICHAIN.md §1](./MULTICHAIN.md#1-the-chains) /
`deployments/chains.json` (`rpcEnv`). Keep ≥ 2 providers per chain:

```bash
# Primary down -> use backup; recovery is identical.
RPC_URL="$ROBINHOOD_TESTNET_RPC_URL_BACKUP" scripts/dr-restore.sh reconcile
```

Validate a backup before trusting it:

```bash
cast chain-id   --rpc-url "$BACKUP" && \
cast block-number --rpc-url "$BACKUP"   # head should be near the primary's
```

**Indexer.** Run ≥ 2 indexer replicas behind a health check; each is a
deterministic function of chain events, so a standby converges independently.
Failover = route reads to the healthy replica; rebuild a dead one with §2's
`reindex` backfill. The frontend's `/api/actions`
([INTEGRATION §10](./INTEGRATION.md#10-apiactions-response-schema-frontend-serves))
can also read directly from chain in a degraded mode if the indexer is down.

---

## 7. DR drill (run quarterly)

1. On a scratch host with only the git repo + a backup RPC, run
   `scripts/dr-restore.sh all 1`.
2. Confirm: manifest signature verifies, `reconcile` matches production,
   regenerated proofs root == on-chain root, re-pin returns a CID, reindex
   backfills to current head.
3. Time it. Record the RTO. File gaps as issues. This is the real test that
   "on-chain + git" is genuinely sufficient — keep it green.
