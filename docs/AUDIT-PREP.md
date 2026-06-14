# Parvalon — Audit Preparation (P0-3)

> Self-assessment to maximize the value of an external audit (P0-3 in
> [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md)). It records the automated
> analysis run, the disposition of every finding, the test/invariant coverage an
> auditor can rely on, and the precise scope to hand a firm. An external audit is
> still **required before mainnet** — this does not replace it.

## 1. Toolchain run

| Tool | Version | Command | Result |
|---|---|---|---|
| Foundry tests | forge 1.5.1 | `forge test` | **81 passed, 0 failed** (unit + fuzz + invariants + audit-regression) |
| Multi-agent review | 8 adversarial agents + readiness pass | (see §6) | 5 findings (incl. a fund-lock recovery) — **all fixed** (§6), regression-tested |
| Slither | 0.11.5 | `slither . --config-file slither.config.json` | 7 results, **0 high / 0 medium** — all low / informational, dispositioned below |
| forge fmt | 1.5.1 | `forge fmt --check` | clean |
| Gas | — | `forge test --gas-report` | `claim ≈ 82k`, `fund ≈ 108k` |

Config filters vendored OpenZeppelin, `test/`, `script/`, and `src/mocks/` so findings
point only at production sources.

## 2. Slither findings & disposition

| # | Detector | Location | Severity | Disposition |
|---|---|---|---|---|
| 1 | `missing-zero-check` | `SplitAwareCollateral` keeper (ctor + `setKeeper`) | Low | **Fixed** — added `ZeroAddress` guards. |
| 2 | `reentrancy-benign` | `FunctionsActionSource.requestAttestation` writes `_pending[requestId]` after `ROUTER.sendRequest` | Low (false-positive) | **Accepted.** The `requestId` is *returned by* the call, so it cannot be stored earlier; the router is the trusted Chainlink Functions router; this is exactly the pattern in Chainlink's own `FunctionsClient`. No state an attacker can corrupt. |
| 3 | `reentrancy-events` | same function, event after call | Info | **Accepted** — same reasoning; event ordering only. |
| 4 | `timestamp` | `claim` (`< payableAt`) and `sweepUnclaimed` (`<= claimDeadline`) | Info (false-positive) | **Accepted.** Dates are coarse-grained (hours/days); a validator's few-second timestamp leeway is immaterial to record-date/claim-window semantics. |
| 5 | `naming-convention` | `REGISTRY`, `ROUTER` immutables not mixedCase | Info | **Accepted (intentional).** SCREAMING_SNAKE for immutables is the convention `forge-lint` recommends; we standardize on it. Slither's default mixedCase preference is the conflicting style. |

No reentrancy, access-control, arithmetic, or unchecked-call findings in the value path.

## 3. What an auditor can lean on (coverage map)

**Property / invariant tests (formal-verification candidates — §3 of PRODUCTION-READINESS):**

| Property | Test |
|---|---|
| Solvency: `balanceOf(distributor) == funded − claimed` | `InvariantDistributor.invariant_Solvency`, `InvariantLifecycle.invariant_Conservation` |
| Claimed never exceeds funded; funded capped at total | `InvariantDistributor`, `InvariantLifecycle.invariant_Bounds` |
| Root immutable after publish | `InvariantLifecycle.invariant_RootImmutable` |
| `CLAIMABLE ⇒ funded == totalPayout` | `InvariantLifecycle.invariant_ClaimableImpliesFullyFunded` |
| Status forward-only (no regression) | `InvariantLifecycle.invariant_StatusForwardOnly` |
| No double-claim; exact leaf amount | `DividendDistributor.test_Claim_RevertsDoubleClaim`, `test_Claim_RevertsWrongAmount` |
| Cross-action proof non-replay (actionId in leaf) | `test_Claim_RevertsWrongProof` + leaf encoding |
| Full cycle over N holders | `E2EFuzz.testFuzz_FullCycle_NHolders` (2–60 holders) |
| Governance: admin behind timelock, fast-pause by Safe | `Governance.t.sol` (4 tests) |
| Oracle provenance gate | `FunctionsActionSource.t.sol` (8), `AdminActionSource.t.sol` (5) |

## 4. Audit scope to hand the firm

Priority order (value path first):

1. **`DividendDistributor`** — `fund`/`claim`/`sweepUnclaimed`: CEI ordering, `nonReentrant`, `SafeERC20` edge cases (fee-on-transfer, missing-return, rebasing payout tokens), per-action accounting isolation, `Overfunded` cap, sweep-vs-claim race, `BitMaps` correctness, the `actionView` hot-path projection's fidelity to `getAction`.
2. **`CorporateActionRegistry`** — status state-machine transition guards, role isolation (`onlyIssuer` / `onlyDistributor` / admin), `publishRoot` record-block enforcement + root immutability.
3. **Merkle binding** — leaf encoding, `actionId`-binding (cross-action replay), proof verification vs `MerkleProof` sorted-pair semantics, second-preimage posture; **JS↔Solidity parity** (the CLI reproduces the on-chain root from live logs — see `tooling/snapshot/src/parity.test.ts`).
4. **Oracle seam** — `IActionSource` swap safety (`setActionSource` not affecting in-flight actions); `AdminActionSource` `autoAttest`; `FunctionsActionSource` request/fulfill, `OnlyRouter`, unknown-request handling, `authentic` decoding.
5. **Governance** — `TimelockController` wiring, role handover completeness (deployer fully renounced), fast-pause path.
6. **Snapshot pipeline** — determinism, off-by-one at `recordBlock`, balance reconstruction under reorgs and chunk boundaries, exclusion-list correctness.

**Deliverable:** report → fixes → re-verification, all closed before mainnet. Immutable
contracts mean a fix is a fresh audited deployment + migration (deliberate, transparent).

## 5. Reproduce

```bash
cd contracts
forge test                                   # 81 tests
forge test --gas-report                      # gas table
slither . --config-file slither.config.json  # static analysis
forge fmt --check                            # formatting
```

## 6. Resolved findings — multi-agent adversarial review

An 8-agent adversarial pass (vector-scan, math, access-control, economic, execution-trace,
invariant, periphery, first-principles) found the issues below. **All are fixed**, each with a
regression test in `test/AuditRegression.t.sol`.

| # | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| 1 | **High** | `claim` had no per-action solvency cap — an action whose Merkle leaves exceed its funding (malicious issuer, or an honest snapshot bug) could drain USDG that other actions funded in the shared pool, breaking the "funds for one action are never accounted against another" invariant. | `claim` now reverts `ExceedsFunded` when `_claimedTotal[id] + amount > _funded[id]`. An action can never pay out more than it funded, regardless of root integrity. | `test_Audit1_ClaimCannotDrainSiblingAction` |
| 2 | Medium | Cancelling a partially-funded action (`fund` is permissionless and deposits in `ROOT_PUBLISHED`) stranded the deposited tokens — no exit path for a `CANCELLED` action. | `cancelAction` restricted to `ANNOUNCED` only. Funding cannot begin until `ROOT_PUBLISHED`, so a cancellable action provably holds zero funds. | `test_Audit2_CannotCancelPartiallyFundedAction`, `test_Audit2_CancelStillWorksWhenAnnounced` |
| 3 | Low | `sweepUnclaimed` lacked `whenNotPaused`, so value could exit to the issuer during an emergency pause while holders were frozen out of claiming. | Added `whenNotPaused` to `sweepUnclaimed` — the emergency stop now freezes all value movement symmetrically. | `test_Audit3_SweepBlockedWhilePaused` |
| 4 | Lead→fixed | `fund` credited the *requested* amount, not the *received* balance — a fee-on-transfer / rebasing `payoutToken` could mark an action `CLAIMABLE` while under-funded. | `fund` now credits the measured balance delta (`balanceOf` before/after), so accounting always matches the real balance. Still: prefer the documented standard USDG and consider a `payoutToken` allowlist in production (see [LIMITATIONS.md](./LIMITATIONS.md)). | `test_Audit4_FeeOnTransferCreditsReceivedAmount` |
| 5 | Medium | (Production-readiness pass) A `ROOT_PUBLISHED` action that is partially funded but never reaches `totalPayout` had **no exit** — `claim` and `sweepUnclaimed` both require `CLAIMABLE`, and `cancelAction` is `ANNOUNCED`-only (finding #2), so any deposited tokens were permanently locked by an under-funding or abandoned round. | Added issuer-only `DividendDistributor.cancelPublishedAction` + a distributor-gated registry transition `ROOT_PUBLISHED → CANCELLED` that refunds `_funded[id]` and voids the action. Safe by construction: no claim is possible before `CLAIMABLE`, so the full deposit is recoverable and `_claimedTotal` is zero. | `PublishedActionRecoveryTest` (9 tests) |

Open leads still recommended for the external audit's attention: the `FunctionsActionSource`
DON-binding (production CBOR arg-passing), attestation replay (no id/nonce in `dataHash`), the
permissionless `fund` design choice, and the illustrative keeper-trust in `SplitAwareCollateral`.
