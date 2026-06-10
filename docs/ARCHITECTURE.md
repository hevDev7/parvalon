# CorporaX — Architecture

> How the protocol is built and **why** it is built this way. For the frozen
> cross-package API (exact signatures, schemas, env vars) see
> [INTEGRATION.md](./INTEGRATION.md). For the security analysis see
> [THREAT-MODEL.md](./THREAT-MODEL.md).

---

## 1. The shape of the problem

A corporate action in traditional markets is a four-beat sequence:

1. **Announce** — the issuer/registrar declares the action (e.g. "$0.50/share cash dividend").
2. **Record date** — ownership is frozen at a point in time; whoever holds on that date is entitled.
3. **Payment** — funds are distributed pro-rata to the record-date holders.
4. **Reconciliation** — unclaimed amounts are handled; the action closes.

CorporaX reproduces exactly this sequence on-chain, with one hard constraint: **we do not control the token.** The TSLA/AMZN tokens on Robinhood Chain are deployed and owned by Robinhood. We cannot add transfer hooks, we cannot make them rebasing or dividend-paying, and we cannot require their issuer to call into us. Every architectural decision below falls out of that constraint.

The decisive consequence is the **Merkle-snapshot model** (design decision **D1**). Because we cannot observe transfers from inside the token, we observe them from outside: `eth_getLogs` over the token's `Transfer` events up to the record block reconstructs the exact holder set, permissionlessly, for *any* standard ERC-20. The "record date" becomes a **record block**. This is not a workaround — it is a faithful, and arguably cleaner, mapping of how corporate actions actually work.

---

## 2. Components

```
                         off-chain                            on-chain
                ┌───────────────────────────┐    ┌──────────────────────────────────┐
                │  Snapshot CLI (viem, TS)  │    │  CorporateActionRegistry          │
   record block │  eth_getLogs Transfer →   │    │   state authority (no value)      │
   ────────────►│  balances at recordBlock  │────│   • announce / publishRoot /      │
                │  StandardMerkleTree.of()  │root│     cancel                         │
                │  → root, totalPayout,     │    │   • per-asset issuer roles        │
                │    proofs.json (v1 schema)│    │   • lifecycle status machine      │
                └───────────────────────────┘    │   • IActionSource seam (D3)       │
                                                  └──────────────┬────────────────────┘
                ┌───────────────────────────┐                   │ DISTRIBUTOR_ROLE
                │  CorporaX dApp (Next.js)  │                   │ (markClaimable / markFinalized)
                │  /claim  /issuer  /feed   │     viem/wagmi     ▼
                │  /api/actions             │◄─────────►┌──────────────────────────────────┐
                │  wagmi/viem · gasless     │           │  DividendDistributor              │
                │  relayer (claim-on-behalf)│           │   value authority                 │
                └───────────────────────────┘           │   • fund / claim / sweepUnclaimed │
                                                         │   • Merkle verify + claim bitmap  │
                ┌───────────────────────────┐           │   • SafeERC20, nonReentrant       │
                │  AdminActionSource (D3)   │◄──validate─┤                                   │
                │  issuer-fed attestations  │            └──────────────┬────────────────────┘
                │  → Chainlink Functions    │                           │ safeTransfer
                │    adapter in prod        │                           ▼
                └───────────────────────────┘                   USDG (payout) · TSLA/AMZN
                                                                 (read-only snapshot source)
```

| Component | Mutability | Holds value? | Responsibility |
|---|---|---|---|
| `CorporateActionRegistry` | immutable | **no** | The single authority over *state*: what actions exist, their parameters, their snapshot root, and their lifecycle status. |
| `DividendDistributor` | immutable | **yes** | The single authority over *value*: custody of funded USDG, Merkle-verified claims, sweeps. The only holder of `DISTRIBUTOR_ROLE`. |
| `AdminActionSource` (`IActionSource`) | swappable | no | The D3 oracle seam — vouches for the authenticity of an announcement before the registry records it. |
| Snapshot CLI | off-chain | no | Deterministically reconstructs holder balances at the record block and emits the canonical `proofs.json`. |
| dApp + `/api/actions` | off-chain | no | Holder/issuer/integrator surfaces and the machine-readable CAE-1 action feed. |
| `MockERC20` / `MockPool` | — | — | Test/demo fixtures (faucet token; demo-only reinvest pool). Clearly labeled non-production. |

---

## 3. The registry / distributor split

The two core contracts are split along a **state-vs-value** boundary. This is the central design choice and it pays off in several places.

**`CorporateActionRegistry` is the state authority.** It records actions, enforces record-date semantics and the status state machine, and stores the Merkle root. **Value never touches it.** It cannot pull or push tokens; it has no token balances; a bug in it cannot drain funds.

**`DividendDistributor` is the value authority.** It custodies funded USDG and is the *only* contract that can move it, always via `SafeERC20`, always under `nonReentrant`, always following checks-effects-interactions. It is the sole holder of the registry's `DISTRIBUTOR_ROLE`, so it — and only it — can advance an action from `ROOT_PUBLISHED → CLAIMABLE` (on full funding) and from `CLAIMABLE → FINALIZED` (on sweep).

Why this matters:

- **Blast radius.** A bug or compromise in the registry cannot move money; a bug in the distributor cannot rewrite the historical action ledger. The two highest-value invariants live in separate contracts.
- **Lifecycle integrity is mechanical, not trusted.** An action becomes `CLAIMABLE` only when the distributor has actually received `totalPayout` — the status flip is a *side effect* of the funds arriving (`fund()` calls `markClaimable()` only when `newFunded == totalPayout`), not a separate trusted call. The UI never shows "claimable" before the money is really there.
- **Clean reads on the hot path.** The distributor reads action data through `actionView()` — a gas-lean projection that omits the unbounded `metadataURI` string — so a claim never pays to copy calldata it doesn't use (see §7).

The distributor holds the registry address as `immutable REGISTRY`; the registry holds no distributor address, only the role grant. The relationship is one-directional and fixed at deploy.

---

## 4. The Merkle-snapshot model (D1) — and why

### How a payout is computed

1. The issuer announces with a `recordBlock` slightly in the future and a `ratePerShare` (payout per `1e18` units of the asset).
2. Once `block.number > recordBlock`, the snapshot CLI runs:
   - `eth_getLogs` for `Transfer(from, to, value)` on the asset, chunked, from the token's deploy block to `recordBlock`.
   - Replays them into a balance map; keeps every address with balance `> 0`.
   - Computes `amount = balanceAtRecordBlock * ratePerShare / 1e18` per holder.
   - Assigns each holder a stable 0-based `index` (also its bitmap slot).
   - Builds `StandardMerkleTree.of(rows, ["uint256","uint256","address","uint256"])` where each row is `[actionId, index, account, amount]`.
   - Emits `root`, `totalPayout = Σ amount`, and `proofs.json` (`corporax-merkle-v1`).
3. The issuer `publishRoot(id, root, totalPayout, holderCount)`.
4. The issuer `fund(id, totalPayout)`; on full funding the action flips to `CLAIMABLE`.
5. Each holder (or anyone on their behalf) calls `claim(id, index, account, amount, proof)`.

### Leaf encoding (canonical — do not change)

```
leaf = keccak256( bytes.concat( keccak256( abi.encode(actionId, index, account, amount) ) ) )
```

This is the OpenZeppelin `StandardMerkleTree` double-hash. The inner `keccak256` over `abi.encode(...)` is the leaf preimage; the outer `keccak256(bytes.concat(...))` is the second-preimage guard that makes leaf-vs-internal-node confusion infeasible. On-chain, `MerkleProof.verify` (commutative / sorted-pair hashing) checks the supplied `proof` against the stored `merkleRoot`. OZ's `@openzeppelin/merkle-tree` produces proofs that verify against this by design.

`actionId` is bound **into** the leaf. This is what makes a proof non-replayable: a valid `(index, account, amount, proof)` for action 1 cannot be reused against action 2, because the leaf — and therefore the root it must verify against — differs.

### Why Merkle snapshot, not an accumulator/dividend-token

| | Merkle snapshot (chosen, **D1**) | Accumulator vault / dividend-paying token |
|---|---|---|
| Requires token control? | **No** — works on any ERC-20 via logs | Yes — needs transfer hooks / a wrapper |
| Record-date semantics | Native (record block = record date) | Awkward; needs per-transfer accounting |
| Claim gas | **O(1)** via bitmap (~82k) | O(1) but requires the token to cooperate |
| Auditability | Anyone re-runs the snapshot, gets the same root | Trust the vault's internal accounting |
| Cost to integrate a new asset | Zero on-chain changes | A wrapper deploy + liquidity migration |

The snapshot model is the only one of these that is *permissionless* over tokens we don't own. That property is the protocol's reason to exist.

### Determinism & auditability

The snapshot is a pure function of public data: `(asset, recordBlock, ratePerShare)` → `(root, totalPayout, proofs)`. Two runs produce byte-identical roots — this is fuzz-tested on-chain in `testFuzz_RootDeterminism`. Anyone can reproduce the root from `Transfer` logs and dispute a fraudulent one. This is transparency a closed transfer-agent system structurally cannot offer.

---

## 5. Record-date semantics

The `recordBlock` field is the on-chain record date, and the contract enforces it as a real constraint, not a label:

- `publishRoot` reverts with `RecordNotTaken` unless `block.number > recordBlock`. You cannot publish a root over a snapshot that isn't final yet — the balance set must be in the past and immutable, or the root isn't reproducible. (`CorporateActionRegistry.publishRoot`, FR-3.)
- `payableAt` (a unix timestamp) gates *claiming*: `claim` reverts with `NotYetClaimable` until `block.timestamp >= payableAt`. Record date and payable date are independent, exactly as in real markets.
- `claimDeadline` (optional; `0` means none) gates *sweeping*: the issuer may `sweepUnclaimed` only after it passes.

Splits and stock dividends carry the same record-date semantics in their metadata but flow no value (see §8, D2).

---

## 6. Status lifecycle — the state machine

```
                       announceAction()
                            │
                            ▼
                     ┌─────────────┐  cancelAction()
                     │  ANNOUNCED  │───────────────────────────┐
                     └──────┬──────┘                           │
                            │ publishRoot()                    │
                            │ (block.number > recordBlock)     │
                            ▼                                   │
                  ┌──────────────────┐  cancelAction()         │
                  │  ROOT_PUBLISHED  │─────────────────────────┤
                  └────────┬─────────┘                         ▼
                           │ fund() reaches totalPayout  ┌────────────┐
                           │ → distributor.markClaimable()│ CANCELLED  │ (terminal)
                           ▼                              └────────────┘
                    ┌─────────────┐
                    │  CLAIMABLE  │  ← claim() happens here only
                    └──────┬──────┘
                           │ sweepUnclaimed() (after claimDeadline)
                           │ → distributor.markFinalized()
                           ▼
                    ┌─────────────┐
                    │  FINALIZED  │ (terminal)
                    └─────────────┘
```

Properties enforced by the registry:

- **Forward-only.** Each transition checks the *current* status and reverts `InvalidStatus` otherwise. There is no path back to an earlier state.
- **`CANCELLED` only before value moves.** Reachable from `ANNOUNCED` or `ROOT_PUBLISHED` only — never once an action is `CLAIMABLE`, so no claim can ever be undone by a cancel.
- **Value-moving transitions are distributor-only.** `markClaimable` and `markFinalized` are gated by `DISTRIBUTOR_ROLE`. Issuers can `announce/publishRoot/cancel`; only the distributor can flip into or out of `CLAIMABLE`. This means "claimable" provably implies "funded".
- **Root is immutable after publish.** `publishRoot` requires status `ANNOUNCED`; it cannot be called again. The snapshot root cannot change once an action leaves `ANNOUNCED`. (Invariant: *root immutable after CLAIMABLE*.)
- **Single emit chokepoint.** Every transition funnels through `_setStatus`, which emits `ActionStatusChanged(id, previousStatus, newStatus)` — so off-chain consumers reconstruct the full lifecycle from events alone.

Informational actions (`STOCK_SPLIT` / `STOCK_DIVIDEND`) live as `ANNOUNCED` and may be finalized administratively; they never enter the funding/claim path.

---

## 7. Gas design

Gas optimization is concentrated where it is actually felt — the **claim**, which holders pay and which happens N times per action — and deliberately *not* spent on the rare issuer writes, where auditor clarity is worth more than a marginal `SSTORE` saving.

**Claim bitmap.** Consumed claim indices are tracked with `mapping(uint256 id => BitMaps.BitMap)` (OZ `BitMaps`). One storage slot covers 256 holders. Marking a claim is a single warm `SSTORE`; checking double-claims is a single `SLOAD` and a bit test. Measured **`claim()` ≈ 82,172 gas** (`test_Claim_GasUnderTarget`), comfortably under the 90k PRD target — dominated by the unavoidable ERC-20 `safeTransfer`, not by protocol bookkeeping.

**`actionView` projection.** The distributor reads action data through `actionView(id)` → the `ActionView` struct, a lean projection of `CorporateAction` that omits the unbounded `metadataURI` string and the fields the hot path doesn't need (`id`, `ratePerShare`, `recordBlock`). Reading the full struct on every claim would mean copying an arbitrary-length string into memory for no reason; the projection avoids that on the most frequent call.

**Deliberate non-packing of the action struct.** `CorporateAction` keeps `recordBlock`/`payableAt`/`claimDeadline`/enums as sub-256-bit fields but does *not* tightly slot-pack them against the surrounding `uint256`/`address`/`bytes32` fields. The packing would save gas only on `announceAction` — a low-frequency issuer write — at the cost of readability. We took the readable layout. This is an explicit, documented trade-off (see the NatSpec on the struct).

**O(1) issuer ops.** `publishRoot` stores one root and one total regardless of holder count; cost is independent of N. The snapshot work that *is* O(N) happens off-chain in the CLI, where it is cheap and re-runnable.

---

## 8. The D3 seam: `IActionSource` (admin today → Chainlink Functions next)

In a real transfer-agent stack, the *authenticity* of a corporate action originates off-chain — an issuer filing, a DTCC ISO-20022 message, a licensed data vendor. The registry must not hard-code where that truth comes from. So `announceAction` computes a canonical `dataHash` over the full announcement payload and calls `IActionSource.validateAnnouncement(asset, announcer, dataHash)` **before writing any state**. A source that cannot vouch for the announcement *reverts* (it returns nothing on success), so the registry relies on a clean call.

```solidity
interface IActionSource {
    function validateAnnouncement(address asset, address announcer, bytes32 dataHash) external view;
    function sourceType() external view returns (string memory); // e.g. "admin-attested-v1"
}
```

- **v1 (testnet/hackathon): `AdminActionSource`.** Models the real-world fact that a corporate action originates with the issuer/registrar. Authorized attesters vouch for a `dataHash`; the registry then records it. An `autoAttest` flag makes a clean demo a single transaction on testnet; in production it is set to `false`, so every announcement requires an explicit, prior attestation — a genuine off-chain → on-chain provenance gate.
- **production: `ChainlinkFunctionsActionSource`.** Implements the *same* interface, pulling the action from a licensed data vendor inside a Chainlink Functions request and verifying `dataHash` before allowing it on-chain. The admin swaps the source via `setActionSource(newSource)` — **zero changes to the registry, zero migration of existing actions.**

`sourceType()` is surfaced in docs and (in the production feed) per-action, so integrators know exactly how much to trust an action's provenance. This is design decision D3 made concrete: the production path is named and the interface is real, without pretending the testnet has a Chainlink corporate-actions feed it does not.

---

## 9. Trust assumptions

What you must trust, and what you must not, when using CorporaX v1:

| Party | Trusted for | **Not** trusted for / bounded by |
|---|---|---|
| **Per-asset issuer** | Announcing genuine actions; publishing an honest root; funding `totalPayout`. | Cannot touch another asset's actions (per-asset role). Cannot make an action claimable without funding it (mechanical). Cannot change a root after publishing it. Cannot rug a published+funded action (no path back from `CLAIMABLE` except sweep-after-deadline to the issuer of remainder only). |
| **Admin (`DEFAULT_ADMIN_ROLE`)** | Onboarding issuers (`setAssetIssuer`), swapping the oracle source, pausing in emergencies. Documented as a **multisig in production**. | Cannot mint or move funded dividends. Cannot forge a Merkle proof. Pausing halts but does not redirect value. |
| **Action source (D3)** | Vouching that an announcement is authentic. | A malicious source can only *block* or *allow* announcements; it never controls funds or roots. Swappable. |
| **Snapshot CLI / root** | Producing the correct holder set and amounts. | **Verifiable, not trusted** — anyone re-runs it from public logs and checks the root. A wrong root produces a wrong `totalPayout` the issuer would have to fund, and is publicly disputable. |
| **Distributor** | Custody and correct settlement. | Bounded by on-chain invariants: solvent, never overpays, claim-on-behalf always pays `account`. Holds no admin power over the ledger. |

The detailed attacker analysis is in [THREAT-MODEL.md](./THREAT-MODEL.md).

---

## 10. Sequence diagrams

### 10.1 Happy path: announce → claim

```
Issuer        Registry        Snapshot CLI        Distributor        USDG        Holder
  │               │                 │                  │              │            │
  │ announceAction│                 │                  │              │            │
  │──────────────►│ validate via    │                  │              │            │
  │               │ IActionSource   │                  │              │            │
  │               │ status=ANNOUNCED│                  │              │            │
  │◄──────id──────│ emit ActionAnnounced               │              │            │
  │               │                 │                  │              │            │
  │     ...wait until block.number > recordBlock...    │              │            │
  │               │                 │                  │              │            │
  │  run snapshot │  eth_getLogs Transfer → balances    │              │            │
  │──────────────────────────────► │ build tree        │              │            │
  │◄────── root, totalPayout, proofs.json ─────────────│              │            │
  │               │                 │                  │              │            │
  │ publishRoot   │ require block>recordBlock           │              │            │
  │──────────────►│ store root,total; status=ROOT_PUBLISHED            │            │
  │               │ emit MerkleRootPublished            │              │            │
  │               │                 │                  │              │            │
  │ approve(dist,total)                                 │              │            │
  │───────────────────────────────────────────────────────────────► │            │
  │ fund(id,total)│                 │                  │              │            │
  │──────────────────────────────────────────────────►│ safeTransferFrom          │
  │               │                 │                  │─────────────►│            │
  │               │◄── markClaimable (when funded==total) ────────────│            │
  │               │ status=CLAIMABLE; emit Funded + ActionStatusChanged            │
  │               │                 │                  │              │            │
  │               │                 │                  │  claim(id,index,account,amount,proof)
  │               │                 │                  │◄──────────────────────────│ (anyone)
  │               │                 │ verify proof vs merkleRoot       │            │
  │               │                 │ set bitmap[index]; emit Claimed  │            │
  │               │                 │                  │ safeTransfer(account,amount)│
  │               │                 │                  │─────────────►│───────────►│
```

The claim is submittable by *anyone* (`claim-on-behalf`, FR-6) — a relayer, a gasless paymaster, or an agent — but the USDG always settles to `account`. The shipped dApp uses this directly: the `/api/relay-claim` route submits the claim from a funded relayer key so the holder pays no gas, with **zero custody risk** because funds can only land at `account`. A passkey / smart-account onboarding layer (Alchemy Account Kit) is a roadmap enhancement on top of the same seam.

### 10.2 Sweep: reclaiming the remainder

```
Issuer              Distributor          Registry            USDG
  │                      │                   │                 │
  │  ...time passes, block.timestamp > claimDeadline...        │
  │                      │                   │                 │
  │ sweepUnclaimed(id)   │                   │                 │
  │─────────────────────►│ require status==CLAIMABLE           │
  │                      │ require now > claimDeadline          │
  │                      │ require msg.sender == issuer         │
  │                      │ remaining = funded − claimed         │
  │                      │ markFinalized(id) ─►│ status=FINALIZED│
  │                      │ emit UnclaimedSwept │                 │
  │                      │ safeTransfer(issuer, remaining) ─────►│
  │◄─────────────────────│                   │                 │
```

`markFinalized` runs **before** the transfer (checks-effects-interactions), and claims require `CLAIMABLE`, so no claim can race a sweep: the moment the action is finalized, claiming is impossible.

---

## 11. What lives off-chain, and why

| Concern | Where | Rationale |
|---|---|---|
| Holder-set reconstruction (O(N)) | Snapshot CLI | Cheap, re-runnable, and verifiable off-chain; putting it on-chain would be pointless and expensive. |
| Proof storage / distribution | `proofs.json` (committed; IPFS in prod) | Proofs are public data derived from the root; the chain only needs the root. |
| Action metadata (ticker, ex-date, ratios, tax flags) | `metadataURI` (IPFS) | Unbounded, human-oriented JSON has no business in storage; the chain pins it by URI. |
| Provenance of the action | `IActionSource` (D3) | Authenticity originates off-chain; the seam keeps the registry agnostic. |
| Gasless relay / sponsorship | Relayer route (`/api/relay-claim`) today; Alchemy paymaster next | `claim-on-behalf` makes this safe; the contract is indifferent to who submits. |

The on-chain footprint is intentionally minimal: the registry stores *state*, the distributor stores *value and a bitmap*, and everything that can be a verifiable function of public data is computed off-chain.
