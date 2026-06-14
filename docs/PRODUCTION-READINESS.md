# Parvalon — Production Readiness

> An honest, prioritized roadmap from a hackathon MVP to a production corporate-
> actions protocol. What ships today is deliberately small and auditable; this
> document is the plan for everything between "it works on testnet" and "an issuer
> can run real distributions on it." Phases are **P0** (must precede mainnet),
> **P1** (scale & robustness), **P2** (platform breadth). Effort is rough
> engineering time for a small team; risk is the consequence of *not* doing it.

For the security analysis these controls defend against, see
[THREAT-MODEL.md](./THREAT-MODEL.md). For what is intentionally simplified in v1,
see [LIMITATIONS.md](./LIMITATIONS.md).

---

## 0. Where we are today (the honest baseline)

**Shipped and solid:**

- Two immutable, no-proxy, no-`delegatecall` contracts (`CorporateActionRegistry`, `DividendDistributor`) + the swappable `IActionSource` seam.
- OZ v5.1.0 patterns throughout: `AccessControl`, `Pausable`, `ReentrancyGuard`, `SafeERC20`, `MerkleProof`, `BitMaps`. Custom errors, full NatSpec, an event for every state change.
- **81 contract tests + 157 TS tests** (unit + fuzz to 60 holders + invariants + audit-regression) green; `claim() ≈ 82.4k gas` for a representative claim (~100k gas-report median across proof depths); deterministic, verifiable Merkle root (CLI reproduces the on-chain root from live logs).
- The state-vs-value split caps blast radius; admin has no path to holder funds.

### 0.1 Code-complete in this repo (the P0/P1/P2 build-out)

The following roadmap items are **implemented and tested in-repo**. What remains for each is an
**operational / vendor / deployment** action (a multisig to create, an audit firm to engage, a
Functions subscription to fund, a cloud KMS to provision) — not code.

| Item | What landed | Still needs (ops) |
|---|---|---|
| P0-1/P0-2 | `DeployGovernance.s.sol` + `Governance.t.sol`: `TimelockController` holds admin, Safe holds pauser | create the Safe; run the handover — **no committed deployment has run it yet; every deployment to date is single-key** (admin == pauser == issuer EOA) |
| P0-3 | Expanded invariants (`InvariantLifecycle`), slither (0 high/med), **8-agent adversarial review → 2 findings + 1 minor fixed + regression-tested** ([AUDIT-PREP.md](./AUDIT-PREP.md) §6) | engage an external audit firm |
| P0-4 | `FunctionsActionSource` + `MockFunctionsRouter` + `DeployFunctionsSource.s.sol` | fund a Functions subscription; deploy the off-chain source |
| P0-5 | Snapshot CLI over real `Transfer` logs (chunked/retry/resume) — parity-proven | — (already the production path) |
| P0-6 | `@parvalon/monitor` service (solvency + lifecycle alerts, webhook sink) | point at a prod RPC; wire the alert channel |
| P0-7/P0-8 | `scripts/drills.sh`, `scripts/deploy-and-verify.sh`, [DEPLOY.md](./DEPLOY.md) | run on the target chain |
| P1-1/P1-2 | `subgraph/` (codegen+build pass) + Allium SQL; CLI `--pin-ipfs` | host a Graph node / pin to a real IPFS provider |
| P1-3/P1-5 | CLI `--exclude`/`--exclude-file`, `--withholding-bps` + metadata schema | issuer supplies exclusion list + withholding policy |
| P1-6 | `@parvalon/sdk` (typed reads/writes + CAE-1 watchers, 30 tests) | publish to npm |
| P1-9 | `scripts/onboard-issuer.sh` + [ONBOARDING.md](./ONBOARDING.md) | run per issuer |
| P2-1 | `SplitAdjuster` library + `SplitAwareCollateral` example | integrators adopt |
| P2-2/P2-3 | [eip-cae1.md](./eip/eip-cae1.md) draft; `examples/agent` (x402 narrative) | submit to Ethereum Magicians |
| P2-4/5/6 | `deployments/chains.json`, [MULTICHAIN.md](./MULTICHAIN.md), [KEY-MANAGEMENT.md](./KEY-MANAGEMENT.md), [DR.md](./DR.md) + `scripts/dr-restore.sh` | provision KMS; rehearse DR |

**Still genuinely external (cannot be "done" in a repo):** the external audit itself, the live
multisig/timelock deployment, a funded Chainlink subscription, a production IPFS/Graph/Allium account,
and a cloud HSM/KMS. Everything that *can* be code, is.

---

## 1. Phased roadmap

### P0 — Required before any mainnet / real-value deployment

| # | Item | What it means concretely | Effort | Risk if skipped |
|---|---|---|---|---|
| P0-1 | **Multisig admin** | Move `DEFAULT_ADMIN_ROLE` + `PAUSER_ROLE` on both contracts to a Safe (e.g. 3-of-5). No single key onboards issuers, swaps the oracle, or pauses. | S | Single-key compromise = oracle swap / issuer hijack. |
| P0-2 | **Timelock on governance + issuer money-moving ops** | Route `setActionSource`, `setAssetIssuer`, and ideally `publishRoot`/`fund` through a timelock so a published root and its funding are observable before claims open. | M | Silent root swap or rushed funding with no challenge window. |
| P0-3 | **External security audit** | Scope below (§2). Fix-and-reverify before mainnet. | L (vendor) | Unknown high-sev bug in value path. |
| P0-4 | **Productionize the oracle (`ChainlinkFunctionsActionSource`)** | Implement the `IActionSource` interface against a licensed data vendor, verifying `dataHash` in a Functions request before allowing an announcement. Set `AUTO_ATTEST=false`. Swap via `setActionSource` — zero registry changes. | M–L | Fabricated actions recorded as authentic; no real provenance gate. |
| P0-5 | **Real snapshot pipeline (replace the seed shortcut)** | The off-chain snapshot CLI over real `Transfer` logs is the production path; the `Seed.s.sol` Solidity-root shortcut is demo-only and must not touch real tokens. Add chunked `getLogs`, retry/resume, and a published root + `proofs.json`. | M | Wrong holder set / non-reproducible root. |
| P0-6 | **Monitoring & alerting** | Watch the solvency invariant on-chain (`balance == funded − claimed` per action), `ActionAnnounced` anomalies, large/duplicate funding, pause state. Page on violation. | M | Incident discovered by users, not operators. |
| P0-7 | **Circuit-breaker drills + runbook** | Exercise pause/unpause, issuer rotation, and incident triage (RUNBOOK §9/§11) on testnet; document escalation. | S | Pause exists but no one has rehearsed using it. |
| P0-8 | **Reproducible verified deploys** | Pin compiler + deps; deterministic bytecode (already on); verified on Blockscout/Arbiscan; deployment artifacts committed and signed. | S | Verification drift; unverifiable production bytecode. |

### P1 — Scale, robustness, and the integrator surface

| # | Item | What it means concretely | Effort | Risk if skipped |
|---|---|---|---|---|
| P1-1 | **Indexer at scale (Allium / subgraph)** | Replace ad-hoc `getLogs` with a managed indexer for large holder sets and historical depth; the snapshot becomes a query, not a scan. | M | Snapshots slow/unreliable as holder counts grow. |
| P1-2 | **IPFS / content-addressed proof hosting** | Pin each `proofs.json` to IPFS, reference the CID in `metadataURI`/feed, verify integrity client-side. | S | Proofs served from a single mutable origin. |
| P1-3 | **Exclusion lists (LP / escrow / bridge)** | Configurable per-asset exclusion of contract addresses (AMM pools, bridges, escrows) from the eligible set, so dividends don't accrue to non-beneficial-owner contracts. | M | LP/escrow contracts capture dividends meant for end holders. |
| P1-4 | **Gasless infra hardening** | Alchemy Gas Manager policy limits, paymaster funding alerts, per-account/per-action rate limits and abuse controls; safe fallback to EOA. | M | Sponsorship drained / abused; UX regresses silently. |
| P1-5 | **Tax / compliance metadata + withholding** | Standardize withholding-rate and jurisdiction fields in `metadataURI`; optionally support a net-of-withholding `amount` and a withholding sink. (Mechanism only; legal/KYC remains issuer responsibility.) | M | Issuers can't model real withholding; blocks regulated use. |
| P1-6 | **TypeScript SDK** | A typed client (using `abis/index.ts`) for announce/snapshot/publish/fund/claim and CAE-1 subscription, so integrators don't hand-roll calldata. | M | Each integrator re-implements the protocol surface. |
| P1-7 | **Observability / dashboards** | Per-action funding/claim progress, sweep status, gas, claim success rate; SLA-grade metrics for issuers. | S–M | No operational visibility for issuers. |
| P1-8 | **CI/CD gates** | Required: full forge suite, fuzz/invariant runs (`ci` profile), gas-regression check on `claim`, ABI export diff, frontend type/lint. Block merge on failure. | S | Regressions reach production. |
| P1-9 | **Multi-issuer onboarding flow** | Self-serve (admin-gated) issuer registration per asset, with attestation wiring; documented onboarding. | M | Onboarding is manual `cast` calls. |

### P2 — Platform breadth & long-horizon

| # | Item | What it means concretely | Effort | Risk if skipped |
|---|---|---|---|---|
| P2-1 | **In-kind splits / stock dividends** | Optional wrapper vault + a `SplitAdjuster` library so integrators (lending/AMM) auto-adjust on split events; in-kind share issuance where a wrapped token is available. | L | Splits stay informational-only. |
| P2-2 | **CAE-1 as a public ERC** | Take the event/leaf/enum spec to Ethereum Magicians; ship a reference impl and conformance tests. | M | Standard stays single-vendor. |
| P2-3 | **Claim relayer + x402 / agent subscriptions** | A first-party relayer and agent-subscription rails (PRD M3) leveraging claim-on-behalf. | M | Agent UX requires bespoke relays. |
| P2-4 | **Multi-chain / mainnet** | Robinhood Chain mainnet + additional Orbit chains; per-chain deployment registry. | M | Confined to one testnet. |
| P2-5 | **HSM / KMS key management** | Issuer and admin signers behind an HSM/KMS with policy + audit logging. | M | Keys in software wallets. |
| P2-6 | **Disaster recovery** | Documented restore from on-chain state + committed artifacts; signer-loss playbook; backup RPCs/indexers. | S–M | No tested recovery path. |

> **Effort key:** S ≈ days, M ≈ 1–3 weeks, L ≈ multi-week / external.

---

## 2. External audit scope (P0-3)

Prioritize the value path and the trust seams:

- **`DividendDistributor`** — `fund`/`claim`/`sweepUnclaimed`: CEI ordering, reentrancy, `SafeERC20` edge cases (fee-on-transfer, missing-return tokens), per-action accounting isolation, `Overfunded` cap, sweep-vs-claim race, bitmap correctness.
- **`CorporateActionRegistry`** — the status state machine (every transition guard), role isolation (`onlyIssuer`/`onlyDistributor`/admin), `publishRoot` record-block enforcement, root immutability, the `actionView` projection's fidelity to `getAction`.
- **Merkle binding** — leaf encoding, `actionId`-binding (cross-action replay), proof verification against `MerkleProof`'s sorted-pair semantics, second-preimage posture.
- **`IActionSource` / `AdminActionSource`** — attestation lifecycle, `autoAttest` semantics, swap safety (`setActionSource` not affecting in-flight actions).
- **Snapshot pipeline** — determinism, off-by-one at `recordBlock`, balance reconstruction against reorgs and chunk boundaries.
- **Upgrade/governance** — multisig + timelock wiring once P0-1/P0-2 land.

Deliverable: report + fixes + re-verification, all addressed pre-mainnet.

## 3. Formal-verification / property-test candidates

Strong fits for Certora/SMT or expanded foundry invariants:

1. **Solvency** — `balanceOf(distributor) == Σ_active (funded − claimed)` always (already an invariant; promote to formal).
2. **No overpayment** — for every `(id, index)`, at most one successful `claim`, paying exactly the leaf `amount`.
3. **Conservation** — for any action: `funded == claimed + swept_or_recoverable`; nothing is created or destroyed.
4. **Lifecycle soundness** — status is monotonic along the allowed DAG; `CLAIMABLE ⇒ funded == totalPayout`; no claim possible outside `CLAIMABLE ∧ now ≥ payableAt`.
5. **Root immutability** — once status leaves `ANNOUNCED`, `merkleRoot` never changes.
6. **Role isolation** — no function reachable by an actor outside its allowed set (issuer/distributor/admin).

## 4. Monitoring & alerting plan (P0-6)

| Signal | Source | Alert when |
|---|---|---|
| Solvency drift | per-action `balanceOf` vs `funded − claimed` | not equal → **page** |
| Pause state change | `Paused`/`Unpaused` events | any → notify |
| Anomalous announcement | `ActionAnnounced` | unexpected asset/issuer, implausible `ratePerShare`/`totalPayout` |
| Funding anomaly | `Funded` | duplicate/over-large funding, funding from unexpected source |
| Claim health | `Claimed` rate, revert rate | spike in reverts (bad proofs / UI bug) |
| Sweep | `UnclaimedSwept` | sweep before expected; large remainder |
| Paymaster | Gas Manager metrics | sponsorship near policy limit / unusual burn |

## 5. Snapshot pipeline at scale (P0-5 / P1-1..3)

- **Indexing:** Allium or a hosted subgraph for `Transfer` history; the snapshot becomes a balance query at `recordBlock` rather than a full-range scan, with retry/resume.
- **Reproducibility:** publish `(asset, recordBlock, rate)` → anyone re-derives the root; CI re-runs determinism on every change.
- **Proof hosting:** content-address `proofs.json` to IPFS; reference the CID; verify integrity client-side (no trust in a mutable origin).
- **Exclusion lists:** per-asset config to drop AMM pools / bridges / escrows from eligibility so payouts reach beneficial owners (today's testnet default includes all `>0` balances — see [LIMITATIONS.md](./LIMITATIONS.md)).
- **Reorg safety:** snapshot only at depth (final block); the on-chain `RecordNotTaken` guard already forbids publishing before `recordBlock` passes.

## 6. Gasless infrastructure (P1-4)

- **Policy limits** on the Alchemy Gas Manager (per-account, per-action, daily caps).
- **Paymaster funding alerts** with auto-top-up thresholds.
- **Abuse controls:** rate-limit sponsored claims; since `claim-on-behalf` always pays `account`, sponsorship abuse is a *cost* risk, not a theft risk — but it must still be bounded.
- **Graceful fallback** to EOA claiming when sponsorship is unavailable, with clear UX (no silent failure).

## 7. Tax / compliance metadata (P1-5)

Parvalon provides *mechanism*, not legal compliance (PRD §3.2). Production adds standardized `metadataURI` fields for withholding rate, jurisdiction, ex-/record-/pay-dates, and tax classification; optionally a net-of-withholding payout with a withholding sink address. KYC/AML and legal determinations remain the issuer's responsibility; the protocol exposes the hooks to support them.

## 8. Definition of "production-ready"

All **P0** complete and independently verified:

- [ ] Multisig admin on both contracts; governance + money-moving ops timelocked.
- [ ] External audit passed; findings fixed and re-verified.
- [ ] `ChainlinkFunctionsActionSource` live; `AUTO_ATTEST=false`.
- [ ] Real snapshot pipeline (no seed shortcut) producing reproducible roots, proofs on IPFS.
- [ ] Monitoring on the solvency invariant + lifecycle events, with paging.
- [ ] Pause/rotation/incident drills rehearsed; DR documented.
- [ ] Reproducible, verified deploys with committed artifacts.

P1 brings it to **scale and a real integrator surface**; P2 to **platform breadth** (CAE-1 ERC, in-kind actions, multi-chain). The wedge is dividends; the destination is the transfer-agent layer for on-chain capital markets (PRD §17).
