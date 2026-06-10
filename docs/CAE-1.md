# CAE-1: Corporate Action Events, v1

> **Status:** Draft · **Type:** Interface Standard · **Layer:** Application
> **Requires:** ERC-20 · **Origin:** CorporaX (Robinhood Chain / Arbitrum)
>
> A standard for emitting, enumerating, and consuming **corporate-action events**
> for tokenized equities on-chain — dividends, splits, and stock dividends — in a
> way that works over tokens the publisher does **not** control.

This document specifies CAE-1 as a credible draft standard. The exact on-chain
event and JSON shapes are normative and are mirrored verbatim in the frozen
[INTEGRATION.md](./INTEGRATION.md); where the two could ever diverge,
INTEGRATION.md is authoritative.

---

## 1. Abstract

Tokenization standards (ERC-20 and friends) define how a share *exists* and *transfers*. They say nothing about the **post-issuance lifecycle** of that share — the dividends it pays, the splits it undergoes, the record dates that govern entitlement. CAE-1 fills that gap with a minimal, ERC-20-compatible event vocabulary so that any party — a lending market, an AMM, a portfolio dashboard, an AI agent — can subscribe to corporate actions and react deterministically, *without* the cooperation of the underlying token.

## 2. Motivation

Three classes of consumer are blind today:

1. **Holders** have no standard signal that a dividend is owed or claimable, and no auditable proof of distribution.
2. **DeFi protocols** using tokenized equities as collateral or as an AMM leg have no standard way to learn that a token went ex-dividend or underwent a 4:1 split. The price discontinuity at a split, or the value leakage at a dividend, is a real risk that must be priced in — and right now it must be discovered out-of-band per issuer.
3. **Autonomous agents** operating on-chain cannot execute dividend-aware or split-aware strategies against data they cannot read in a uniform format.

A *standard* — rather than one protocol's bespoke events — is what lets an integrator write the consumer logic **once** and have it work across every issuer and every asset that adopts CAE-1.

### 2.1 Design constraints

- **Permissionless over uncontrolled tokens.** CAE-1 MUST be emittable by an overlay protocol that does not own the underlying token. It therefore standardizes events on a *registry/distributor*, not on the token itself. (Contrast: a dividend-paying-token standard requires control of the token.)
- **Record-date native.** Entitlement is fixed at a record point and resolved by a snapshot; CAE-1 events carry that record point explicitly.
- **Provenance-aware.** Consumers should be able to learn *how much to trust* an action's authenticity (issuer-attested vs. data-vendor-verified).
- **Cheap to consume.** A consumer should be able to fully reconstruct an action's lifecycle from indexed events alone, with an optional off-chain feed for convenience.

## 3. Terminology

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, MAY are to be interpreted as in RFC 2119.

- **Action** — a single corporate action with a unique, monotonic `id`.
- **Issuer** — the address authorized to manage actions for a given asset.
- **Record block** — the block at which holder balances are snapshotted; the on-chain "record date".
- **Root** — the Merkle root committing to the eligible `(index, account, amount)` set.
- **Distributor** — the value-settling contract for `CASH_DIVIDEND` actions.

## 4. Enumerations

### 4.1 `ActionType` (uint8)

| Value | Name | Semantics |
|---:|---|---|
| 0 | `CASH_DIVIDEND` | Pro-rata cash (e.g. USDG) distribution; flows value through the distributor; claimable by holders. |
| 1 | `STOCK_SPLIT` | **Informational** in v1: forward/reverse split ratio in metadata. No value flow. |
| 2 | `STOCK_DIVIDEND` | **Informational** in v1: additional-shares ratio in metadata. No value flow. |

> Splits and stock dividends are informational because a CAE-1 publisher does not, in general, control the underlying token and therefore cannot rebase it. What integrators need is a *standardized signal and ratio*, which CAE-1 provides; in-kind execution is out of scope for v1 (see §9 versioning, and CorporaX [LIMITATIONS.md](./LIMITATIONS.md)).

### 4.2 `ActionStatus` (uint8)

| Value | Name | Meaning |
|---:|---|---|
| 0 | `ANNOUNCED` | Recorded on-chain; record block may or may not have passed. |
| 1 | `ROOT_PUBLISHED` | Merkle root + `totalPayout` published; awaiting funding. |
| 2 | `CLAIMABLE` | Fully funded; holders may claim. |
| 3 | `FINALIZED` | Claim window closed and remainder swept. |
| 4 | `CANCELLED` | Voided before any claim occurred. |

Transitions are forward-only: `ANNOUNCED → ROOT_PUBLISHED → CLAIMABLE → FINALIZED`, with `CANCELLED` reachable only from `ANNOUNCED`/`ROOT_PUBLISHED`. See [ARCHITECTURE.md §6](./ARCHITECTURE.md#6-status-lifecycle--the-state-machine).

## 5. Event schema (normative)

A CAE-1 registry MUST emit the following. A CAE-1 distributor MUST emit the value events. All `id`-keyed events index `id`; `asset` and `account` are indexed where present so consumers can filter cheaply.

### 5.1 Registry events

```solidity
event ActionAnnounced(
    uint256 indexed id,
    address indexed asset,
    uint8   actionType,        // ActionType
    uint256 ratePerShare,      // payout per 1e18 units of asset (CASH_DIVIDEND); 0 for informational
    uint64  recordBlock,       // the on-chain record date
    uint64  payableAt,         // unix ts at/after which claims open
    uint64  claimDeadline,     // unix ts after which sweep is allowed (0 = none)
    address payoutToken,       // settlement asset (e.g. USDG); address(0) for informational
    string  metadataURI        // off-chain JSON: ticker, ex-date, split ratio, tax flags, ...
);

event MerkleRootPublished(
    uint256 indexed id,
    bytes32 root,
    uint256 totalPayout,       // exact funding target = Σ leaf amounts
    uint256 holderCount
);

event ActionStatusChanged(
    uint256 indexed id,
    uint8   previousStatus,    // ActionStatus
    uint8   newStatus
);
```

### 5.2 Distributor events

```solidity
event Funded(
    uint256 indexed id,
    address indexed from,
    uint256 amount,
    uint256 totalFunded        // cumulative
);

event Claimed(
    uint256 indexed id,
    uint256 index,             // bitmap slot consumed
    address indexed account,   // who the funds settled to
    uint256 amount
);

event UnclaimedSwept(
    uint256 indexed id,
    address indexed to,        // the issuer
    uint256 amount
);
```

A consumer that ingests these six events can reconstruct the full, current state of every action — its parameters, its root, its lifecycle, its funding and claim progress — with no contract reads required.

## 6. Leaf & proof binding (normative)

For `CASH_DIVIDEND` actions, the eligible set committed by `root` MUST use:

```
leaf = keccak256( bytes.concat( keccak256( abi.encode(actionId, index, account, amount) ) ) )
```

- ABI tuple: `(uint256 actionId, uint256 index, address account, uint256 amount)`.
- This is the OpenZeppelin `StandardMerkleTree` double-hash; on-chain verification uses `MerkleProof.verify` (commutative / sorted-pair).
- `actionId` MUST be bound into the leaf so proofs are **non-replayable across actions**.
- `amount = balanceAtRecordBlock * ratePerShare / 1e18`.
- `index` is the holder's unique 0-based position and the bitmap slot the claim consumes.

Binding the leaf encoding into the standard means a CAE-1 proof generated by one tool verifies against any compliant distributor.

## 7. The off-chain action feed (`/api/actions`)

For convenience, a CAE-1 publisher SHOULD expose a machine-readable HTTP feed that flattens the event-derived state. CorporaX serves this at `GET /api/actions`:

```json
{
  "chainId": 46630,
  "generatedAt": "ISO8601",
  "actions": [
    {
      "id": 1,
      "asset": "0x..",
      "assetSymbol": "TSLA",
      "actionType": "CASH_DIVIDEND",
      "status": "CLAIMABLE",
      "ratePerShare": "0.5",
      "recordBlock": 1234,
      "payableAt": 1781110880,
      "claimDeadline": 1781715680,
      "payoutToken": "0x..",
      "merkleRoot": "0x..",
      "totalPayout": "12.0",
      "totalClaimed": "5.0",
      "holderCount": 2,
      "metadataURI": "ipfs://..",
      "explorerUrl": "https://.."
    }
  ]
}
```

- Amounts in the feed are **human-decimal strings**; on-chain values remain wei. (Enumerations are stringified for readability: `"CASH_DIVIDEND"`, `"CLAIMABLE"`.)
- The feed is a *derived view*; the events in §5 are the source of truth. A consumer that needs trust-minimization SHOULD subscribe to events directly and treat the feed as a cache.
- A production feed SHOULD additionally surface the action's **provenance tag** (`sourceType()` from the `IActionSource`, e.g. `"admin-attested-v1"` vs. `"chainlink-functions-v1"`) so consumers can weight trust.

The `proofs.json` artifact (`corporax-merkle-v1`, [INTEGRATION.md §5](./INTEGRATION.md)) is the companion to the feed: the feed tells you an action exists and is claimable; `proofs.json` gives a specific holder their `index`, `amount`, and `proof`.

## 8. How integrators consume CAE-1

### 8.1 Lending markets

Subscribe to `ActionAnnounced`. On `STOCK_SPLIT`, read the ratio from `metadataURI` and adjust the collateral factor / oracle scaling at the record block so a 4:1 split does not register as a 75% price crash and trigger spurious liquidations. On `CASH_DIVIDEND`, account for the value leaving the token at the ex-date when marking collateral.

### 8.2 AMMs / DEX routers

On `STOCK_SPLIT` / `STOCK_DIVIDEND`, flag affected pools so quoting and arbitrage protection are aware of the discontinuity. On `CASH_DIVIDEND` going `CLAIMABLE`, surface to LPs that holders may now claim.

### 8.3 AI agents

The combination of (a) a uniform event stream, (b) the `/api/actions` feed, and (c) **claim-on-behalf** (`claim()` may be submitted by anyone, funds always settle to `account`) lets an agent detect an `ActionAnnounced`, decide a strategy, and *execute the claim for its principal* in one autonomous loop — without holding the principal's keys. This is the agent-native property CAE-1 is designed to enable.

### 8.4 Reference subscription (viem)

```ts
import { createPublicClient, http, parseAbiItem } from "viem";
const client = createPublicClient({ transport: http(process.env.RPC_URL) });

const unwatch = client.watchEvent({
  address: REGISTRY_ADDRESS,
  event: parseAbiItem(
    "event ActionAnnounced(uint256 indexed id, address indexed asset, uint8 actionType, uint256 ratePerShare, uint64 recordBlock, uint64 payableAt, uint64 claimDeadline, address payoutToken, string metadataURI)"
  ),
  onLogs: (logs) => logs.forEach((l) => handleAction(l.args)),
});
```

> Use the typed ABIs in `abis/index.ts` (`registryAbi`, `distributorAbi`) for full inference rather than hand-writing event fragments in production.

## 9. Versioning

CAE-1 is **version 1**. Versioning rules:

- The event signatures in §5 and the leaf encoding in §6 are **frozen** within v1. Adding a new `ActionType` value (e.g. `RIGHTS_ISSUE = 3`, `MERGER = 4`) is a **backward-compatible** extension: existing consumers ignore unknown types; it does not bump the major version.
- A change that alters an existing event's parameters, the leaf encoding, or status semantics is **breaking** and MUST ship as CAE-2 with a distinct on-chain footprint.
- The `proofs.json` artifact carries its own `format` discriminator (`corporax-merkle-v1`); the feed carries `chainId` + `generatedAt`. Consumers SHOULD branch on these.
- In-kind split/stock-dividend execution, withholding-tax metadata fields, and multi-token payouts are candidate **v2** features (tracked in [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md)).

## 10. Security considerations

- **Provenance is not authenticity of computation.** CAE-1 events attest *what was published*; they do not, by themselves, prove the *snapshot was computed correctly*. The Merkle root is the binding commitment — consumers and holders SHOULD treat the root as verifiable (re-runnable from public `Transfer` logs) rather than trusted. See [ARCHITECTURE.md §4](./ARCHITECTURE.md#4-the-merkle-snapshot-model-d1--and-why).
- **Proof replay** is prevented by binding `actionId` into the leaf (§6).
- **Trust weighting** SHOULD use the `sourceType()` provenance tag; an `"admin-attested-v1"` action is only as trustworthy as its attester, whereas a `"chainlink-functions-v1"` action is verified against a licensed data vendor.
- A consumer MUST treat the `/api/actions` feed as untrusted convenience data and reconcile against on-chain events for anything value-bearing.

## 11. ERC-track framing

CAE-1 is structured to graduate to a public ERC. The natural standardization path:

1. **Interface ERC** — `ActionType` / `ActionStatus` enumerations, the six events of §5, and the leaf binding of §6, specified independently of any one implementation. This is the part other issuers and overlays would implement.
2. **Companion data ERC** — the `proofs.json` (`corporax-merkle-v1`) and `/api/actions` shapes as recommended off-chain formats.
3. **Reference implementation** — the CorporaX `CorporateActionRegistry` + `DividendDistributor` as the canonical reference, with the `IActionSource` provenance seam as an optional, pluggable extension.

The goal is that an integrator who writes a CAE-1 consumer once can support corporate actions across *every* compliant issuer on Arbitrum and beyond — the same way ERC-20 let a wallet support every token once. Post-hackathon, the intent is to take CAE-1 to Ethereum Magicians for review (see PRD §17 roadmap M3).
