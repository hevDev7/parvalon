# CorporaX — Audit Preparation (P0-3)

> Self-assessment to maximize the value of an external audit (P0-3 in
> [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md)). It records the automated
> analysis run, the disposition of every finding, the test/invariant coverage an
> auditor can rely on, and the precise scope to hand a firm. An external audit is
> still **required before mainnet** — this does not replace it.

## 1. Toolchain run

| Tool | Version | Command | Result |
|---|---|---|---|
| Foundry tests | forge 1.5.1 | `forge test` | **67 passed, 0 failed** (unit + fuzz + invariants) |
| Slither | 0.11.5 | `slither . --config-file slither.config.json` | 9 results, **0 high / 0 medium** — all low / informational, dispositioned below |
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
forge test                                   # 67 tests
forge test --gas-report                      # gas table
slither . --config-file slither.config.json  # static analysis
forge fmt --check                            # formatting
```
