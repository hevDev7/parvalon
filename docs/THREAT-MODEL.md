# CorporaX — Threat Model

> A STRIDE-style analysis of the CorporaX protocol as built. Every mitigation is
> mapped to a concrete contract control or test. Scope is the on-chain protocol
> (`CorporateActionRegistry`, `DividendDistributor`, `AdminActionSource`) plus the
> snapshot/frontend trust boundaries. See [ARCHITECTURE.md](./ARCHITECTURE.md) for
> the design rationale and [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md) for
> the controls that are roadmap rather than shipped.

---

## 1. Assets (what an attacker wants)

| Asset | Where it lives | Worst-case loss |
|---|---|---|
| **Funded dividend USDG** | `DividendDistributor` balance | Theft / drain of holder funds. |
| **Holder entitlement** | committed in the Merkle `root` | A holder paid less than owed, or someone else paid in their place. |
| **Action ledger integrity** | `CorporateActionRegistry` state | A forged/altered action, or a tampered status/root. |
| **Action provenance** | `IActionSource` (D3) | A fabricated corporate action recorded as if authentic. |
| **Availability of claims** | claim path | Holders blocked from claiming what they are owed. |

The protocol holds **no value in the registry** — only the distributor custodies funds. That split (state vs. value) caps the blast radius of any single component (see ARCHITECTURE §3).

---

## 2. Actors

| Actor | Capability | Disposition |
|---|---|---|
| **Holder** | Owns asset at record block; submits claims. | honest-but-self-interested |
| **Per-asset issuer** | `setAssetIssuer`-assigned; announce/publish/fund/sweep for *their* asset. | semi-trusted (bounded) |
| **Admin** (`DEFAULT_ADMIN_ROLE`) | Onboard issuers, swap source, pause. Multisig in prod. | trusted (bounded; cannot move funds) |
| **Attester** (`ATTESTER_ROLE`) | Vouch announcements on the source. | trusted for provenance only |
| **Relayer / paymaster / agent** | Submits `claim` on a holder's behalf. | untrusted (cannot redirect funds) |
| **External attacker** | Arbitrary EOA/contract; reads all state; crafts calldata. | adversarial |
| **Malicious token** | A non-standard ERC-20 used as asset or payout. | adversarial (bounded by SafeERC20) |

---

## 3. Trust boundaries

```
   UNTRUSTED                          │  SEMI-TRUSTED         │  TRUSTED (bounded)
                                      │                       │
  attacker EOAs ─┐                    │  per-asset issuer ─┐  │  admin / multisig
  relayers/agents├─► claim (anyone)   │  announce/publish/ ├──┼─► setAssetIssuer
  malicious token┘   funds→account    │  fund/sweep        │  │   setActionSource
                                      │                    │  │   pause/unpause
  ──────────────── on-chain contracts (immutable) ────────┼──┼───────────────────
                                      │                    │  │
  off-chain: snapshot CLI (root is VERIFIABLE, not trusted)│  │  D3 source (swappable;
             /api/actions feed (untrusted convenience)     │  │  vouches provenance only)
```

The most security-relevant boundary: the **Merkle root is verifiable, not trusted.** Anyone can reconstruct it from public `Transfer` logs. A dishonest root does not silently steal — it produces a publicly disputable `totalPayout` the issuer must fund.

---

## 4. STRIDE enumeration

### 4.1 Spoofing (identity)

| Threat | Mitigation | Control / test |
|---|---|---|
| Non-issuer calls `announceAction`/`publishRoot`/`cancelAction` | Per-asset issuer check via `_assetIssuer[asset]`; reverts `Unauthorized(caller, asset)`. | `onlyIssuer` modifier + inline checks in `publishRoot`/`cancelAction`. Tests: unauthorized-announce/publish/cancel revert. |
| Random caller advances lifecycle (`markClaimable`/`markFinalized`) | Gated by `DISTRIBUTOR_ROLE`; only the distributor holds it; reverts `NotDistributor`. | `onlyDistributor` modifier. Granted once in `Deploy.s.sol`. |
| Spoofed sweep recipient | `sweepUnclaimed` resolves `issuer = REGISTRY.assetIssuer(asset)` and requires `msg.sender == issuer`; funds go to the resolved issuer, not a caller-supplied address. | `DividendDistributor.sweepUnclaimed`. Test: sweep authorization. |
| Spoofed admin operations | OZ `AccessControl` role checks; `setAssetIssuer`/`setActionSource` are `onlyRole(DEFAULT_ADMIN_ROLE)`. | OZ `AccessControl`. |

### 4.2 Tampering (integrity)

| Threat | Mitigation | Control / test |
|---|---|---|
| Forge a claim for funds not owed | `claim` recomputes the canonical leaf and runs `MerkleProof.verify` against the stored `merkleRoot`; mismatch reverts `InvalidProof`. | `DividendDistributor.claim`. Tests: wrong-proof revert, wrong-amount revert. |
| Replay a valid proof against another action | `actionId` is bound into the leaf, so a proof only verifies against its own action's root. | leaf = `keccak256(bytes.concat(keccak256(abi.encode(id, index, account, amount))))`. Tests: cross-action proof rejected. |
| Mutate a root after publishing | `publishRoot` requires status `ANNOUNCED` and cannot be re-called; root is written once. | status guard `InvalidStatus`. Invariant: *root immutable after CLAIMABLE*. |
| Backdate/forge the snapshot | `publishRoot` reverts `RecordNotTaken` unless `block.number > recordBlock`; the holder set must be finalized. Root is independently reproducible from logs. | `publishRoot` record-block check (FR-3) + `testFuzz_RootDeterminism`. |
| Skip lifecycle states | Each transition checks the exact current status; forward-only; `_setStatus` is the single mutation chokepoint. | registry state machine. Tests: invalid-status transitions revert. |

### 4.3 Repudiation (auditability)

| Threat | Mitigation | Control / test |
|---|---|---|
| An issuer denies announcing / a claim is disputed | Every state change emits a CAE-1 event (`ActionAnnounced`, `MerkleRootPublished`, `ActionStatusChanged`, `Funded`, `Claimed`, `UnclaimedSwept`); full lifecycle reconstructable from events. | event emission throughout both contracts (INTEGRATION §3). |
| Dispute over snapshot correctness | Root is a pure function of public `(asset, recordBlock, rate)`; anyone re-derives it; `proofs.json` is published. | snapshot determinism; verify mode. |

### 4.4 Information disclosure

Low relevance — all action data is public by design (a corporate action *should* be transparent). No secrets, keys, or PII live on-chain. The only sensitive material is operator private keys, which are off-chain (see §5, key compromise, and RUNBOOK §8).

### 4.5 Denial of service

| Threat | Mitigation | Control / test |
|---|---|---|
| Griefing claims by repeatedly claiming an index | First claim sets the bitmap; a repeat reverts `AlreadyClaimed` and changes nothing. | `BitMaps` + `claim` guard. Tests: double-claim revert; invariant over random claim orderings. |
| One holder's failure blocks others | Claims are independent per index; no shared queue, no ordering dependency. | per-index bitmap; `invariant_*` hold under arbitrary claim order (`InvariantDistributorTest`). |
| Unbounded loop / gas-bomb on the hot path | No loops in `claim`/`fund`/`sweep`; O(1) bitmap; off-chain O(N) snapshot. | `claim ≈ 82.4k gas` for a representative claim (`test_Claim_GasUnderTarget`, asserts < 150k); ~100k gas-report median across Merkle-proof depths. |
| Malicious payout token reverts/consumes gas on transfer | `SafeERC20` for all movements; a token that always reverts only blocks *its own* action's claims/funding, isolated from other actions (per-action accounting). | `SafeERC20`; payout token is the issuer's own choice (USDG). |
| Stuck funds if no one claims | `sweepUnclaimed` (post-deadline) returns the remainder to the issuer. It **is** gated by `whenNotPaused`, so an emergency pause freezes it too (unpause to recover). | `DividendDistributor.sweepUnclaimed`. Tests: sweep before/after deadline; `test_Audit3_SweepBlockedWhilePaused`. |
| Stuck funds in a never-fully-funded published action | `cancelPublishedAction` lets the issuer recover any partial funding and cancel a `ROOT_PUBLISHED` action before it is claimable — the exit that prevents stranded issuer capital. | `DividendDistributor.cancelPublishedAction`; `PublishedActionRecoveryTest`. |

### 4.6 Elevation of privilege

| Threat | Mitigation | Control / test |
|---|---|---|
| Reentrancy to double-spend a claim or re-enter funding | `nonReentrant` on `fund`/`claim`/`sweepUnclaimed`; strict checks-effects-interactions (bitmap set & totals updated *before* `safeTransfer`). | OZ `ReentrancyGuard`; CEI ordering in code. Solvency invariant. |
| Make an action `CLAIMABLE` without funding it | Status flips to `CLAIMABLE` only inside `fund` when `newFunded == totalPayout`; it is a mechanical side effect of funds arriving, not a separate trusted call. | `fund` → `markClaimable` only on full funding. |
| Overfund / accounting bleed between actions | `Overfunded` cap (`newFunded > totalPayout` reverts); funds tracked per `id` (`_funded`/`_claimedTotal` keyed by id). | `fund` cap. `invariant_FundedCapped`, per-id accounting. |
| Admin drains holder funds | Admin has **no** withdrawal path; it can only onboard issuers, swap the (provenance-only) source, and pause. Pause halts but never redirects value. | absence of any admin transfer function; `pause()` is a halt only. |
| Upgrade/`delegatecall` to inject logic | Immutable contracts, no proxy, no `delegatecall`, no upgradeability. | design (PRD §11); nothing to attack. |

---

## 5. Attack surfaces (named)

### 5.1 Issuer key compromise

**Impact:** An attacker with an issuer key can announce bogus actions for that issuer's assets, publish a self-serving root, fund it, and — after the deadline — sweep. They **cannot** touch another asset's actions (per-asset scoping) and cannot rewrite history (events + immutable root).
**Mitigations (shipped):** per-asset role isolation; the root is publicly disputable; admin can pause and `setAssetIssuer` to rotate the key out (RUNBOOK §8–9).
**Mitigations (roadmap):** per-issuer multisig, timelock on publish/fund, monitoring/alerting on anomalous announcements ([PRODUCTION-READINESS](./PRODUCTION-READINESS.md) P0/P1).

### 5.2 Malicious / incorrect proofs

**Impact:** none to the contract — a wrong proof simply reverts `InvalidProof`. The real risk is an *incorrect published root* (over- or under-paying holders).
**Mitigations:** the root is verifiable from public logs (anyone re-runs the snapshot); determinism is fuzz-tested; a discrepancy is a pause-and-reissue incident (RUNBOOK §9/§11). Funds can never exceed `totalPayout` regardless of root content (`Overfunded` cap + solvency invariant).

### 5.3 Reentrancy

**Impact:** classic double-withdraw if mis-ordered.
**Mitigations:** `nonReentrant` on every mutator; CEI strictly followed — `_claimed[id].set(index)` and `_claimedTotal[id] += amount` execute **before** `safeTransfer`. The solvency invariant (`balance == funded − claimed`) is asserted under randomized claim sequences in `InvariantDistributorTest`.

### 5.4 Griefing

**Impact:** attempts to waste gas or block others.
**Mitigations:** claims are independent and idempotent (bitmap); no shared mutable queue; O(1) hot path; `sweepUnclaimed` prevents permanent fund lock. There is no operation whose cost scales with attacker-controlled input on-chain.

### 5.5 Oracle / source trust (D3)

**Impact:** a compromised `IActionSource` could vouch for a fabricated announcement (or, conversely, block legitimate ones).
**Mitigations (shipped):** the source can only gate *announcements* — it never touches funds or roots, so its worst case is a recorded-but-unfunded fake action that holders can ignore and that produces no payout. The admin can `setActionSource` to a known-good source and `pause()` the registry. `sourceType()` exposes provenance so consumers weight trust (CAE-1 §10). In production, `AUTO_ATTEST=false` requires an explicit prior attestation per action.
**Mitigations (roadmap):** Chainlink Functions source verifying a licensed data-vendor payload against `dataHash` before allowing it on-chain.

### 5.6 Frontend / RPC / feed

**Impact:** a compromised frontend or `/api/actions` feed could mislead a user about amounts or claimability; a malicious RPC could feed stale state.
**Mitigations:** the feed and frontend are **untrusted convenience layers** — the binding truth is on-chain events and the root. `claim` parameters (`index/amount/proof`) are verified on-chain, so a tampered UI cannot cause an incorrect payout; at worst it can cause a *reverting* transaction. Holders/integrators needing trust-minimization subscribe to events and reconcile against `proofs.json`. (Hardening — SRI, pinned RPC, content integrity for `proofs.json` over IPFS — is roadmap.)

### 5.7 Token integration risk

**Impact:** a non-standard asset token (transfer-restricted, fee-on-transfer, non-18-decimals) could distort snapshots; a non-standard payout token could break transfers.
**Mitigations:** the **asset is read-only** (we only read its logs), so even a transfer-restricted asset still yields a valid snapshot and claims still pay in USDG. Payout movements use `SafeERC20`. Decimals assumptions (1e18 for the rate math) are documented in [LIMITATIONS.md](./LIMITATIONS.md); fee-on-transfer payout tokens are out of scope for v1 (USDG is standard).

---

## 6. Invariants (the safety net)

Tested in `InvariantDistributorTest` and the E2E fuzz suite (`E2EFuzz.t.sol`), exercised under randomized inputs and claim orderings:

| Invariant | Statement | Test |
|---|---|---|
| **Solvency** | `usdg.balanceOf(distributor) == totalFunded(id) − totalClaimed(id)` | `invariant_Solvency` |
| **No overpayment** | `totalClaimed(id) ≤ totalFunded(id)` | `invariant_ClaimedNeverExceedsFunded` |
| **Funding cap** | `totalFunded(id) ≤ Σ owed` (== `totalPayout`) | `invariant_FundedCapped` |
| **Root determinism** | same `(asset, recordBlock, rate)` ⇒ identical root | `testFuzz_RootDeterminism` |
| **Full-cycle correctness** | announce→…→claim pays each of N holders exactly once, exact amount | `testFuzz_FullCycle_NHolders` (fuzzed to 60 holders) |

The whole suite — **81 tests** (unit + fuzz + invariants + audit-regression) — passes. These invariants are the formal backstop behind the STRIDE mitigations above: even if a specific control were reasoned about incorrectly, a violation of solvency or no-overpayment would fail the suite.

---

## 7. Residual risk & assumptions (v1)

- The **issuer is semi-trusted** to publish an honest root and fund it; the protocol makes dishonesty *detectable and bounded*, not *impossible*. Production reduces this with multisig + timelock + monitoring.
- The **D3 source is trusted for provenance** in v1 (`AdminActionSource`); production swaps in a verifying oracle.
- **Admin is trusted but cannot move funds** — the strongest privileged actor still has no path to holder USDG.
- Anything labeled "demo-only" (`MockPool`, `MockERC20`, `AUTO_ATTEST=true`) is **not in the production trust model** and is clearly marked as such.

Full, prioritized hardening — multisig, timelock, audit scope, formal-verification candidates, monitoring — is in [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md).
