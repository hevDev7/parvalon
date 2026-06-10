---
eip: cae-1
title: "CAE-1: Corporate Action Events for Tokenized Equities"
description: A permissionless, ERC-20-compatible event vocabulary for announcing, enumerating, and settling on-chain corporate actions (cash dividends, splits, stock dividends) over tokens the publisher does not control.
author: CorporaX (@corporax)
discussions-to: https://ethereum-magicians.org/
status: Draft
type: Standards Track
category: ERC
created: 2026-06-11
requires: 20
---

## Abstract

Tokenization standards such as [ERC-20](./eip-20.md) define how a share *exists*
and *transfers*. They are silent on the **post-issuance lifecycle** of that
share — the dividends it pays, the splits it undergoes, and the record dates
that govern entitlement. CAE-1 specifies a minimal, ERC-20-compatible event
vocabulary, two enumerations, and a canonical Merkle leaf encoding so that any
consumer — a lending market, an AMM, a portfolio dashboard, or an autonomous
agent — can subscribe to corporate actions and react deterministically,
*without* the cooperation of the underlying token.

The standard is split into three conformance surfaces: a normative on-chain
**event schema** (six events across a registry and a distributor), a normative
**Merkle leaf binding** for value-bearing actions, and a RECOMMENDED off-chain
**action feed** (`/api/actions`) plus per-holder proof artifact for convenience.

## Motivation

Three classes of consumer are blind to corporate actions on tokenized equities
today, and each must rediscover the same information out-of-band, per issuer:

1. **Holders** have no standard signal that a dividend is owed or claimable, and
   no auditable, reproducible proof of distribution.
2. **DeFi protocols** that use tokenized equities as collateral or as an AMM leg
   have no standard way to learn that a token went ex-dividend or underwent a
   4-for-1 split. The price discontinuity at a split, or the value leakage at a
   dividend, is a real risk that must be priced in — yet today it must be
   discovered ad hoc for every issuer.
3. **Autonomous agents** operating on-chain cannot execute dividend-aware or
   split-aware strategies against data they cannot read in a uniform format.

A *standard* — rather than one protocol's bespoke events — is what lets an
integrator write the consumer logic **once** and have it work across every
issuer and every asset that adopts CAE-1, the same way ERC-20 let a wallet
support every token once.

### Design constraints

- **Permissionless overlay over uncontrolled tokens.** CAE-1 MUST be emittable
  by an overlay protocol that does not own the underlying token. It therefore
  standardizes events on a *registry/distributor*, not on the token itself.
  (Contrast: a dividend-paying-token standard requires control of the token.)
- **Record-date native.** Entitlement is fixed at a record point and resolved by
  a snapshot; CAE-1 events carry that record point explicitly as a block number.
- **Provenance-aware.** Consumers SHOULD be able to learn *how much to trust* an
  action's authenticity (issuer-attested vs. data-vendor-verified).
- **Cheap to consume.** A consumer MUST be able to fully reconstruct an action's
  lifecycle from indexed events alone, with an OPTIONAL off-chain feed for
  convenience.

## Specification

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in RFC 2119 and RFC 8174.

### Terminology

- **Action** — a single corporate action with a unique, monotonically
  increasing `id` (ids run `1..actionCount`).
- **Issuer** — the address authorized to manage actions for a given asset.
- **Record block** — the block number at which holder balances are snapshotted;
  the on-chain "record date".
- **Root** — the Merkle root committing to the eligible
  `(index, account, amount)` set.
- **Registry** — the contract that announces actions and tracks their lifecycle.
- **Distributor** — the value-settling contract for `CASH_DIVIDEND` actions.

### Enumerations

#### `ActionType` (uint8)

| Value | Name | Semantics |
|---:|---|---|
| 0 | `CASH_DIVIDEND` | Pro-rata cash (e.g. a stablecoin) distribution; flows value through the distributor; claimable by holders. |
| 1 | `STOCK_SPLIT` | **Informational** in v1: forward/reverse split ratio carried in metadata. No value flow. |
| 2 | `STOCK_DIVIDEND` | **Informational** in v1: additional-shares ratio carried in metadata. No value flow. |

A compliant registry MUST encode `actionType` using these values. A consumer
MUST ignore (rather than reject) `actionType` values it does not recognize, so
that future additive types do not break existing consumers (see
[Backwards Compatibility](#backwards-compatibility)).

#### `ActionStatus` (uint8)

| Value | Name | Meaning |
|---:|---|---|
| 0 | `ANNOUNCED` | Recorded on-chain; record block may or may not have passed. |
| 1 | `ROOT_PUBLISHED` | Merkle root + `totalPayout` published; awaiting funding. |
| 2 | `CLAIMABLE` | Fully funded; holders may claim. |
| 3 | `FINALIZED` | Claim window closed and remainder swept. |
| 4 | `CANCELLED` | Voided before any claim occurred. |

Status transitions MUST be forward-only:
`ANNOUNCED → ROOT_PUBLISHED → CLAIMABLE → FINALIZED`, with `CANCELLED` reachable
only from `ANNOUNCED` or `ROOT_PUBLISHED`. A compliant registry MUST emit
`ActionStatusChanged` on every transition.

### On-chain event schema (normative)

A CAE-1 **registry** MUST emit the three registry events; a CAE-1
**distributor** MUST emit the three value events. Every `id`-keyed event MUST
index `id`; `asset` and `account` MUST be indexed where present, so consumers
can filter cheaply by topic.

#### Registry events

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
    uint256 totalPayout,       // exact funding target = sum of leaf amounts
    uint256 holderCount
);

event ActionStatusChanged(
    uint256 indexed id,
    uint8   previousStatus,    // ActionStatus
    uint8   newStatus          // ActionStatus
);
```

#### Distributor events

```solidity
event Funded(
    uint256 indexed id,
    address indexed from,
    uint256 amount,
    uint256 totalFunded        // cumulative funded for this action
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

A consumer that ingests these six events MUST be able to reconstruct the full,
current state of every action — its parameters, its root, its lifecycle, and its
funding and claim progress — with no contract reads required.

### Merkle leaf and proof binding (normative)

For `CASH_DIVIDEND` actions, the eligible set committed by `root` MUST use the
following leaf encoding:

```
leaf = keccak256( bytes.concat( keccak256( abi.encode(actionId, index, account, amount) ) ) )
```

- The ABI tuple types and order MUST be
  `(uint256 actionId, uint256 index, address account, uint256 amount)`.
- This is the OpenZeppelin `StandardMerkleTree` double-hash. On-chain
  verification MUST use sorted-pair (commutative) hashing, e.g. OpenZeppelin
  `MerkleProof.verify`; proofs produced by `@openzeppelin/merkle-tree` verify
  against it by design.
- `actionId` MUST be bound into the leaf so proofs are **non-replayable across
  actions**.
- `amount` MUST equal `balanceAtRecordBlock * ratePerShare / 1e18` (this v1
  assumes the asset uses 1e18 units).
- `index` MUST be the holder's unique 0-based position; it is also the bitmap
  slot the claim consumes, making each `(id, index)` claimable at most once.
- `totalPayout` published in `MerkleRootPublished` MUST equal the sum of all leaf
  `amount` values — the exact funding target.

A producer building the tree MUST construct it as
`StandardMerkleTree.of(rows, ["uint256","uint256","address","uint256"])`, where
each row is `[actionId, index, account, amount]` stringified.

### Claim-on-behalf (normative)

A compliant distributor's `claim` entry point MUST settle funds to the `account`
encoded in the leaf, regardless of `msg.sender`:

```solidity
function claim(
    uint256 id,
    uint256 index,
    address account,
    uint256 amount,
    bytes32[] calldata proof
) external;
```

This makes claims **submittable by any party** (a relayer, a keeper, an agent)
while value can only ever reach the entitled `account`. A compliant distributor
MUST reject a claim whose `(id, index)` slot is already consumed and MUST reject
a claim whose `proof` does not verify against the published `root`.

### Off-chain action feed (RECOMMENDED)

For convenience, a CAE-1 publisher SHOULD expose a machine-readable HTTP feed
that flattens the event-derived state. The RECOMMENDED shape, served at
`GET /api/actions`, is:

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

- Amounts in this public feed MUST be human-decimal strings; on-chain values
  remain wei. Enumerations SHOULD be stringified for readability (e.g.
  `"CASH_DIVIDEND"`, `"CLAIMABLE"`).
- The feed is a *derived view*; the on-chain events are the source of truth. A
  consumer that needs trust-minimization MUST subscribe to events directly and
  treat the feed as a cache.
- A production feed SHOULD additionally surface the action's **provenance tag**
  (an implementation-defined `sourceType()`, e.g. `"admin-attested-v1"` vs.
  `"chainlink-functions-v1"`) so consumers can weight trust.

The companion per-holder proof artifact (the `corporax-merkle-v1` `proofs.json`)
gives a specific holder their `index`, `amount`, and `proof`. The feed tells a
consumer that an action exists and is claimable; the proof artifact lets a
specific holder (or an agent acting for them) actually claim.

### Conformance requirements

A **compliant registry**:

- MUST emit `ActionAnnounced`, `MerkleRootPublished`, and `ActionStatusChanged`
  with the exact signatures above.
- MUST assign monotonically increasing `id`s starting at 1.
- MUST enforce forward-only status transitions and emit `ActionStatusChanged`
  on each.
- SHOULD restrict announcement of an asset's actions to that asset's authorized
  issuer.
- SHOULD expose an action's full parameters via a view function for consumers
  that prefer reads over event replay.

A **compliant distributor**:

- MUST emit `Funded`, `Claimed`, and `UnclaimedSwept` with the exact signatures
  above.
- MUST verify claims against the published `root` using the leaf binding above.
- MUST implement claim-on-behalf semantics (funds settle to `account`).
- MUST prevent double-claims via the `(id, index)` bitmap slot.
- SHOULD reject overfunding beyond `totalPayout` and SHOULD restrict
  `sweepUnclaimed` to after `claimDeadline`.

A **compliant consumer**:

- MUST be able to reconstruct action state from the six events alone.
- MUST ignore unknown `actionType` values rather than reject the event.
- SHOULD treat the off-chain feed as untrusted convenience data and reconcile
  value-bearing decisions against on-chain events.

## Rationale

**Why an overlay registry instead of a token-level standard.** A
dividend-paying-token standard (e.g. one where the token contract itself accrues
and distributes) requires the publisher to *own and control the token*. In the
tokenized-equity setting, the entity best positioned to publish corporate
actions (a transfer agent, a data vendor, an issuer service) frequently does not
control the deployed token. CAE-1 places the standard on a permissionless
registry/distributor pair so corporate actions can be published *over* any
ERC-20 — including tokens deployed before CAE-1 existed.

**Why record-date semantics are explicit.** Entitlement to a dividend is a
function of balance at a fixed point in time. Encoding `recordBlock` directly in
`ActionAnnounced` lets any consumer reproduce the eligible set from public
`Transfer` logs and independently verify the published `root`, rather than
trusting the publisher's off-chain computation. This is what makes the snapshot
*reproducible* rather than *asserted*.

**Why splits and stock dividends are informational in v1.** Because a CAE-1
publisher does not, in general, control the underlying token, it cannot rebase
it. In-kind execution of a split is therefore out of scope for v1. What
integrators actually need to stay correct — a *standardized signal and ratio* —
is exactly what CAE-1 provides. A lending market can read a `STOCK_SPLIT` and
adjust its oracle scaling so a 4-for-1 split does not register as a 75% price
crash and trigger spurious liquidations, without any token rebase. In-kind
execution is a candidate v2 feature.

**Why claim-on-behalf.** Tying settlement to the leaf-encoded `account` rather
than to `msg.sender` decouples *who pays gas* from *who receives value*. This
enables relayers, sponsored transactions, and — most importantly for the
agent-native use case — an autonomous agent that detects an action and executes
the claim *for its principal* without ever holding the principal's keys. The
non-replayable `(actionId, index)` binding makes this safe: an agent cannot
redirect funds, only trigger settlement to the rightful holder.

## Backwards Compatibility

CAE-1 introduces no changes to ERC-20 and requires no modification of existing
token contracts; it is a pure overlay. Existing tokens are usable with CAE-1
unchanged.

Within CAE-1 v1, the event signatures and the leaf encoding are **frozen**.
Versioning rules:

- Adding a new `ActionType` value (e.g. `RIGHTS_ISSUE = 3`, `MERGER = 4`) is a
  **backward-compatible** extension. Existing consumers, which are REQUIRED to
  ignore unknown types, continue to function; this does not bump the major
  version.
- Any change that alters an existing event's parameters, the leaf encoding, or
  status semantics is **breaking** and MUST ship as a distinct standard
  (CAE-2) with its own on-chain footprint.
- Off-chain artifacts carry their own discriminators (the `corporax-merkle-v1`
  `format` field; the feed's `chainId` + `generatedAt`). Consumers SHOULD branch
  on these.

## Reference Implementation

A complete, deployed reference implementation lives in the CorporaX repository
that accompanies this draft:

- `contracts/src/CorporateActionRegistry.sol` — the registry: announces actions,
  publishes roots, and drives the status lifecycle, emitting the three registry
  events above.
- `contracts/src/DividendDistributor.sol` — the distributor: funds, verifies
  claim-on-behalf against the canonical leaf binding, and sweeps unclaimed
  funds, emitting the three value events above.
- `contracts/src/libraries/SplitAdjuster.sol` and
  `contracts/src/examples/SplitAwareCollateral.sol` — a reference *consumer*
  showing how a lending market applies a `STOCK_SPLIT` signal to keep
  collateral valuation correct.
- `contracts/src/oracle/` (`AdminActionSource`, `FunctionsActionSource`) — an
  OPTIONAL, pluggable provenance seam exposing `sourceType()` so consumers can
  weight trust.
- `tooling/snapshot/` — the reference snapshot CLI that reconstructs holder
  balances from on-chain `Transfer` logs at `recordBlock` and emits the
  `corporax-merkle-v1` `proofs.json`, using the canonical leaf binding in
  `tooling/snapshot/src/merkle.ts`.
- `examples/agent/` — a runnable example consumer (an autonomous,
  dividend-aware agent) that subscribes to `ActionAnnounced` and emits strategy
  decisions.
- `docs/INTEGRATION.md` — the frozen integration contract; where this draft and
  that document could ever diverge, `INTEGRATION.md` is authoritative for the
  reference implementation.

The reference implementation ships with a passing test suite (Foundry for the
contracts; Vitest for the tooling).

## Security Considerations

- **Provenance is not authenticity of computation.** CAE-1 events attest *what
  was published*; they do not, by themselves, prove the *snapshot was computed
  correctly*. The Merkle `root` is the binding commitment — consumers and holders
  SHOULD treat the root as verifiable (re-runnable from public `Transfer` logs
  against `recordBlock`) rather than trusted.
- **Proof replay across actions** is prevented by binding `actionId` into the
  leaf. A proof valid for one action MUST NOT verify for another.
- **Double-claim** is prevented by consuming the `(id, index)` bitmap slot on
  each successful claim; a compliant distributor MUST reject a second claim for
  the same slot.
- **Claim redirection** is impossible by construction: settlement targets the
  leaf-encoded `account`, not `msg.sender`. A malicious relayer can at most pay
  gas to deliver funds to the rightful holder.
- **Trust weighting.** Consumers SHOULD use an implementation's provenance tag
  (`sourceType()`) to weight trust; an admin-attested action is only as
  trustworthy as its attester, whereas a data-vendor-verified action carries a
  stronger guarantee.
- **Feed is untrusted.** A consumer MUST treat the off-chain `/api/actions` feed
  as untrusted convenience data and reconcile against on-chain events for
  anything value-bearing.
- **Status-dependent value safety.** A compliant distributor MUST NOT allow
  claims before `CLAIMABLE` and MUST NOT allow `sweepUnclaimed` before
  `claimDeadline`, to prevent funds being claimed against an unfunded or
  premature action, or swept out from under eligible holders.

## Copyright

Copyright and related rights waived via [CC0](../LICENSE).
