# CorporaX — Limitations (v1)

> An honest accounting of what CorporaX v1 does **not** do, and why each
> simplification is the right call for this stage. Engineering honesty is a
> feature: every limitation below is deliberate, scoped, and has a written
> production path in [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md).
> None of them compromises the core safety properties in
> [THREAT-MODEL.md](./THREAT-MODEL.md).

---

## 1. Splits are informational, not rebasing

`STOCK_SPLIT` and `STOCK_DIVIDEND` are recorded as **informational** actions — a standardized CAE-1 event plus a ratio in metadata — and flow **no value**. CorporaX does not rebase or reissue the underlying token.

**Why acceptable.** We deliberately do not control the Robinhood TSLA/AMZN token contracts (design decision D2), so we *cannot* rebase them — and a true rebase isn't what integrators actually need. A lending market or AMM needs a **trustworthy signal and ratio** to adjust collateral factors and oracle scaling at the record block; CorporaX provides exactly that. Pretending to rebase a token we don't own would be dishonest engineering. In-kind execution via an optional wrapper vault + `SplitAdjuster` library is roadmap (P2-1).

## 2. The action oracle is issuer-fed (D3)

Authenticity of an announcement is established by `AdminActionSource` — authorized attesters vouch for the action's `dataHash` — rather than by a licensed market-data feed.

**Why acceptable.** There is no Chainlink corporate-actions feed on this testnet, and in the real world a corporate action genuinely *originates with the issuer/registrar* — so an issuer-attested source is a faithful v1 model, not a hack. Crucially, the source is behind the swappable `IActionSource` interface: a production `ChainlinkFunctionsActionSource` implements the same interface and swaps in via `setActionSource` with **zero registry changes** (P0-4). The source can only gate announcements; it never touches funds or roots, so its blast radius is bounded (THREAT-MODEL §5.5). On testnet `AUTO_ATTEST=true` makes demos one transaction; production sets it `false`.

## 3. Testnet snapshot includes all non-zero balances (no exclusion list)

The snapshot keeps **every address with balance > 0**, including contracts (AMM pools, escrows, bridges).

**Why acceptable.** The testnet holder set is tiny and the exclusion of LP/escrow/bridge addresses is a **production configuration**, not a protocol change (design decision D7). It is captured as P1-3. Including everyone on testnet is the conservative, transparent default; it cannot cause an *incorrect* claim, only dividends accruing to a contract that may not be a beneficial owner.

## 4. The seed script is a snapshot *shortcut* (demo-only)

`Seed.s.sol` builds the Merkle root in Solidity over a known two-holder set to produce clean demo state in one command. The **production path** is the off-chain snapshot CLI over real `Transfer` logs.

**Why acceptable.** The seed script is clearly labeled demo-only in its NatSpec and requires `MockERC20` tokens (it calls `mint`); it never runs against real tokens. It exists purely so a demo can be re-recorded in under five minutes. The canonical, reproducible-from-logs path is the CLI (RUNBOOK §5; P0-5). The on-chain leaf encoding the seed and the CLI both target is identical, so the two are interchangeable from the contract's perspective.

## 5. Single distributor; payout is a single token (USDG)

There is one `DividendDistributor`, and each action pays in one `payoutToken` (USDG in the demo).

**Why acceptable.** One distributor keeps custody and accounting in a single auditable place, with strict per-action isolation enforced on-chain: `_funded`/`_claimedTotal` are keyed by `id`, `fund` is capped by `Overfunded`, and — following the security review — `claim` reverts `ExceedsFunded` if cumulative claims for an action would exceed its own funding, so one action can never spend another's pooled tokens regardless of root integrity. `fund` also credits the **measured balance delta** (not the requested amount), so a fee-on-transfer/rebasing `payoutToken` cannot mark an action claimable while under-funded. That said, the **documented and recommended `payoutToken` is standard USDG**; a production deployment using arbitrary tokens should add a `payoutToken` allowlist (PRODUCTION-READINESS §2/§7). USDG is the ecosystem's native stablecoin and faithfully represents a cash dividend (D4). Multi-token payouts and additional distributors are a v2 concern, not a v1 safety gap.

## 6. USDG decimals / `1e18` rate assumption

The payout math assumes the **asset has `1e18` units** (`amount = balance * ratePerShare / 1e18`), and the demo tokens (USDG/TSLA/AMZN) are 18-decimal.

**Why acceptable.** The tokenized stocks and USDG in scope are 18-decimal ERC-20s, so the assumption holds for the target assets. The assumption is explicit (NatSpec on the struct and leaf encoding in INTEGRATION §4). Supporting non-18-decimal assets is a documented adapter change (scale the rate math by the asset's `decimals()`), tracked alongside fee-on-transfer payout handling in PRODUCTION-READINESS §2/§7. The asset is read-only regardless, so an exotic asset cannot threaten custody — only the rate arithmetic would need scaling.

## 7. No L1 finality assumptions

CorporaX makes no assumptions about Arbitrum → L1 finality or withdrawal timing. Record-date semantics are enforced purely on **L2 block number** (`publishRoot` requires `block.number > recordBlock`).

**Why acceptable.** The protocol settles entirely on L2 in L2-native USDG; there is no cross-domain message, no bridging of dividend funds, and therefore no dependence on the L1 dispute/finality window. Reorg-safe snapshotting at depth is an operational practice (PRODUCTION-READINESS §5), not a protocol assumption. Keeping the protocol L1-finality-agnostic is what lets it deploy unchanged across anvil, Sepolia, and Robinhood Chain.

## 8. Immutable, non-upgradeable contracts

There is no proxy, no `delegatecall`, no upgrade path. A change means a new deployment.

**Why acceptable.** Immutability is a *security and auditability feature* for v1 (PRD §11): two small contracts with no upgrade surface are far easier for a judge or auditor to reason about end-to-end, and there is no upgrade key to compromise. Governance flexibility lives where it belongs — in the swappable oracle source and in role assignment — not in mutable core logic. If the core ever needs to change, a fresh audited deployment plus migration is the deliberate, transparent path.

## 9. Gasless claiming is best-effort UX (with EOA fallback)

Gasless claiming is a UX layer, not a protocol guarantee — the protocol only requires that *someone* submits the `claim` transaction. The shipped dApp implements gasless via a server-side **relayer route** (`/api/relay-claim`) that submits the claim from a funded key, so the holder pays nothing. A **passkey + ERC-4337 smart-account** sign-in (Alchemy Account Kit + Gas Manager), for no-seed-phrase onboarding, is a planned enhancement on the same claim-on-behalf seam — not yet shipped.

**Why acceptable.** `claim-on-behalf` (funds always settle to `account`) is what makes gasless safe — the sponsor/relayer can never redirect funds. If sponsorship is unavailable, a plain EOA claim works identically and the contract is indifferent to who pays gas. So the gasless layer can degrade gracefully without affecting correctness or custody. Sponsorship limits and abuse controls are P1-4.

## 10. Demo-only surfaces

`MockERC20` (mint-faucet token) and `MockPool` (fixed-rate USDG→stock swap backing the optional "claim & reinvest" stretch) are **test/demo fixtures**, explicitly labeled in their NatSpec, and are not part of the production trust model. `MockPool` is not an AMM and has no price discovery, slippage, or liquidity guarantees.

**Why acceptable.** They are clearly fenced off, never wired into the value path of a real deployment, and used only to make local development and the demo reproducible. Judges are never misled about what is production versus scaffolding.

---

## Summary

Every limitation here is a *scoped simplification with a written upgrade path*, not an unknown gap. The properties that matter — solvency, no overpayment, non-replayable proofs, record-date integrity, bounded admin power — hold today and are backed by the 42-test suite and the invariants in [THREAT-MODEL.md §6](./THREAT-MODEL.md#6-invariants-the-safety-net). What v1 trades away is breadth and operational hardening, both of which are sequenced in [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md).
