# @corporax/snapshot

Deterministic Merkle **snapshot CLI** for the CorporaX corporate-actions
protocol. It reconstructs token-holder balances at a record block from on-chain
`Transfer` logs and emits the canonical `corporax-merkle-v1` `proofs.json`
consumed by the contracts (`DividendDistributor.claim`) and the frontend.

> **Why a snapshot at all?** CorporaX is a *permissionless overlay*: it does not
> control the stock token and cannot install transfer hooks. The only honest way
> to know who held what at a record block is to replay the token's `Transfer`
> history up to that block. Anyone can re-run this tool and get the **same root**
> — that reproducibility is the protocol's audit story.

Conforms exactly to [`docs/INTEGRATION.md`](../../docs/INTEGRATION.md) §4 (leaf
encoding) and §5 (`proofs.json` schema). The leaf, tree, and verification rule
match the on-chain `MerkleProof.verify` (sorted-pair keccak256) by construction.

---

## Install & build

This package is an npm workspace of the `corporax` monorepo. From the repo root
or from this directory:

```bash
npm install
npm run -w @corporax/snapshot build      # tsc -> dist/
npm run -w @corporax/snapshot typecheck  # strict, no emit
npm run -w @corporax/snapshot test       # vitest
```

> Use **npm**, not pnpm (pnpm is broken on the dev machine).

---

## Commands

The binary is `corporax-snapshot` (after build) or `npm start --` in dev (runs
`src/cli.ts` via `tsx`).

### `snapshot` — generate proofs.json

```bash
corporax-snapshot snapshot \
  --rpc        http://127.0.0.1:8545 \
  --token      0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 \
  --deploy-block 0 \
  --record-block 2 \
  --rate       500000000000000000 \
  --action-id  1 \
  --payout-token 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  --exclude    0xPool...,0xBridge... \
  --withholding-bps 1500 \
  --jurisdiction US --ex-date 2026-06-01 --pay-date 2026-06-15 --tax-class ordinary \
  --pin-ipfs \
  --out        ../../deployments/proofs-31337-1.json
```

| Flag                   | Required | Meaning                                                                                 |
| ---------------------- | :------: | --------------------------------------------------------------------------------------- |
| `--rpc <url>`          |    △     | RPC endpoint. Falls back to `$RPC_URL`.                                                  |
| `--token <addr>`       |    ✓     | ERC20 asset to snapshot.                                                                 |
| `--deploy-block`       |    ✓     | Token deploy block — lower bound of the `eth_getLogs` scan.                              |
| `--record-block`       |    ✓     | Record block — the snapshot height (inclusive).                                         |
| `--rate <wei>`         |    ✓     | `ratePerShare` in wei (per `1e18` shares).                                               |
| `--action-id`          |    ✓     | Corporate-action id this snapshot is for (binds the leaves).                            |
| `--out <path>`         |    ✓     | Output path for `proofs.json`.                                                           |
| `--chunk <n>`          |          | `eth_getLogs` page size in blocks (default `5000`).                                     |
| `--payout-token`       |          | Payout token address written into the artifact.                                         |
| `--chain-id`           |          | Override the chain id (default: read from the RPC).                                     |
| `--exclude <addrs>`    |          | **(P1-3)** Comma-separated addresses dropped from the eligible set *before* indexing.   |
| `--exclude-file <path>`|          | **(P1-3)** JSON array of addresses to exclude (merged with `--exclude`).                |
| `--withholding-bps <n>`|          | **(P1-5)** Withholding tax in basis points `0..10000`; net leaf = `gross*(10000-n)/10000`. |
| `--jurisdiction <code>`|          | **(P1-5)** Issuer tax jurisdiction recorded in `metadata` (e.g. `US`).                  |
| `--ex-date <date>`     |          | **(P1-5)** Ex-dividend date (`YYYY-MM-DD`) recorded in `metadata`.                      |
| `--record-date <date>` |          | **(P1-5)** Record date (`YYYY-MM-DD`) recorded in `metadata`.                           |
| `--pay-date <date>`    |          | **(P1-5)** Pay date (`YYYY-MM-DD`) recorded in `metadata`.                              |
| `--tax-class <class>`  |          | **(P1-5)** Tax classification recorded in `metadata` (e.g. `ordinary`).                 |
| `--pin-ipfs`           |          | **(P1-2)** Pin the artifact to IPFS; writes the returned CID into `proofsCid`.          |

#### Exclusions (P1-3)

AMM pools, bridges, escrows and the issuer's own treasury are contracts, not
beneficial owners — paying a dividend "to" them strands funds. `--exclude` /
`--exclude-file` drop those addresses from the eligible holder set **before**
index/amount/tree assignment, so they never receive a leaf and `index` numbering
stays dense over the real holders. The applied set is recorded in the artifact's
`exclusions` block (`addresses` = everything requested; `applied` = the subset
that actually held a positive balance and was therefore materially removed) for
auditability. `--exclude-file` accepts a JSON array of address strings (or an
object `{ "addresses": [...] }`).

#### Withholding (P1-5)

`--withholding-bps <n>` applies a flat withholding rate to every holder:

```
net = gross * (10000 - n) / 10000          # BigInt floor division
```

The Merkle **leaf `amount` is the NET claimable amount** (what `claim()` pays),
each claim additionally records its `grossAmount`, the action carries
`withholdingBps` + `totalGross`, and `totalPayout = Σ net` (the exact funding
target). With `--withholding-bps 0` net == gross but the gross fields are still
emitted, making the artifact self-describing. The `verify` command re-checks the
net math (`net == net(gross, bps)`) for every claim. *This is the payout
**mechanism** only — what rate to withhold, and all legal/KYC obligations, are
the issuer's to determine and assert.*

#### IPFS pinning (P1-2)

`--pin-ipfs` content-addresses the exact bytes written to disk so consumers can
fetch the artifact by CID and be sure it matches the published root. Pinning is
pluggable via the `Pinner` interface:

- **Configured** — if `$IPFS_API_URL` is set, an `HttpPinner` POSTs the artifact
  to a Pinata-/IPFS-compatible pinning API (`$IPFS_API_KEY` as a bearer token if
  present; override the endpoint path with `$IPFS_API_PATH`, default
  `/pinning/pinFileToIPFS`). The returned CID is written into the artifact as
  `proofsCid`.
- **Not configured** — a `NoopPinner` logs a clear warning and the artifact is
  written locally *without* `proofsCid` (honest no-op, never a silent fake CID).

The CID references the artifact **without** `proofsCid` (a document cannot embed
its own hash); the on-disk file additionally carries the CID for convenience.

`stdout` prints only the output path; all progress/diagnostics go to `stderr`,
so you can capture the path cleanly:

```bash
OUT=$(corporax-snapshot snapshot ... )   # $OUT = absolute path to proofs.json
```

### `verify` — re-derive & check an artifact (no RPC)

```bash
corporax-snapshot verify ../../deployments/proofs-31337-1.json
```

Re-derives the Merkle root from the leaf set, re-verifies **every** proof against
the stated `merkleRoot` using the contract's sorted-pair rule, and asserts
`Σ amount == totalPayout` and `holderCount == |claims|`. **Exits non-zero** on
any mismatch — drop it into CI to guard committed artifacts.

---

## Algorithm

1. **Scan** — chunked `eth_getLogs` for ERC20 `Transfer(from,to,value)` from
   `--deploy-block` through `--record-block`, with exponential backoff and
   adaptive chunk halving on provider range/limit errors.
2. **Fold** — credit `to`, debit `from`, skip `address(0)` on both sides
   (mints/burns are supply, not a payable holder). BigInt throughout.
3. **Exclude** *(P1-3)* — drop `--exclude` / `--exclude-file` addresses from the
   balance map **before** anything else, so contracts (pools/bridges/escrows)
   never accrue a leaf. Recorded in `exclusions`.
4. **Filter** — keep `balance > 0`.
5. **Sort** — by address ascending (numeric order of the 20-byte value). This
   fixes the `index` (also the on-chain bitmap slot) and makes the run
   reproducible.
6. **Amount** — `gross = balance * ratePerShare / 1e18` (floor division), then
   *(P1-5)* `net = gross * (10000 - withholdingBps) / 10000`. The **net** value
   is the leaf `amount`.
7. **Tree** — `StandardMerkleTree.of(rows, ["uint256","uint256","address","uint256"])`
   with rows `[actionId, index, account, net-amount]` (INTEGRATION.md §4).
8. **Pin** *(P1-2, optional)* — content-address the artifact bytes to IPFS and
   stamp the CID into `proofsCid`.
9. **Emit** — `corporax-merkle-v1` JSON: per-holder `{index, amount[, grossAmount], proof}`
   keyed by lowercase address, plus `merkleRoot`, `totalPayout = Σ net`, and
   (when applicable) `withholdingBps`, `totalGross`, `exclusions`, `metadata`,
   `proofsCid`.

## Artifact extensions (`corporax-merkle-v1`)

The wire `format` string stays **`corporax-merkle-v1`** — every reader that
understood v1 still understands these files because all additions are *optional*
keys (a non-extending run is byte-for-byte the legacy shape). An internal,
informational `schemaMinor` (currently `1`) marks artifacts that may carry the
extensions below. **Do not gate parsing on `schemaMinor`.**

| Field             | When present                  | Meaning                                                        |
| ----------------- | ----------------------------- | -------------------------------------------------------------- |
| `schemaMinor`     | always (this build)           | Additive marker; informational only.                           |
| `withholdingBps`  | `--withholding-bps` supplied  | Action-wide withholding rate in basis points.                  |
| `totalGross`      | `--withholding-bps` supplied  | `Σ gross` (wei). `totalPayout` remains `Σ net`.                |
| `claims[a].grossAmount` | `--withholding-bps` supplied | Per-holder gross (wei); the leaf `amount` stays net.       |
| `exclusions`      | any `--exclude*` supplied     | `{ addresses, applied }` — requested vs. materially removed.   |
| `metadata`        | any metadata flag supplied    | Echo of the `metadataURI` payload (see schema below).          |
| `proofsCid`       | `--pin-ipfs` pinned OK        | IPFS CID of the artifact (without this field).                 |

### `metadataURI` payload schema (mechanism-only)

`announceAction`'s `metadataURI` (e.g. `ipfs://<cid>`) should resolve to a JSON
document with these standardised fields. The snapshot tool both **reads** these
semantics and **echoes** them into the artifact's `metadata` block. These are
*issuer-asserted* — CorporaX does not validate or enforce any legal/KYC claim;
it only standardises the shape so issuer feeds, this CLI, and the frontend agree.

```jsonc
{
  "withholdingBps": 1500,        // int 0..10000 — withholding tax in basis points
  "jurisdiction":   "US",        // issuer tax jurisdiction (ISO-3166 alpha-2)
  "exDate":         "2026-06-01",// ex-dividend date (ISO-8601 YYYY-MM-DD)
  "recordDate":     "2026-06-02",// record date (mirror of recordBlock)
  "payDate":        "2026-06-15",// pay date
  "taxClass":       "ordinary"   // ordinary | qualified | return-of-capital | ...
}
```

All fields are optional; partial issuer metadata is still well-formed. When
`--withholding-bps` is set, the CLI folds the rate into `metadata.withholdingBps`
so the document is internally consistent with the on-chain leaves.

### Determinism

Two runs over the same chain state produce a **byte-identical** artifact: the
holder set is sorted deterministically, OZ assigns tree positions by leaf hash
(so the root depends only on the leaf *set*), and we serialise with a fixed
2-space indent + trailing newline. The test suite asserts this directly,
including that input map **order** does not affect the root.

### Notes / honest limitations

- **Zero-amount leaves:** a holder with a positive balance whose payout floors to
  `0` under the rate (or under withholding) is still included (`amount: 0`) to
  keep indices stable; the contract simply transfers 0 on claim.
- **Exclusions are an allow/deny *input*, not detection:** the tool excludes only
  the addresses you pass via `--exclude` / `--exclude-file`. It does **not**
  auto-detect that an address is a contract/pool — curating that list (from the
  issuer, a registry, or an indexer) is the operator's responsibility.
- **Withholding is flat + mechanism-only:** a single action-wide rate is applied
  to every holder. Per-holder / jurisdiction-specific rates and any legal/KYC
  determination are the issuer's responsibility; this tool only computes the
  net leaf from a given rate. Net uses floor division, so `Σ net ≤ Σ gross`.
- **IPFS pinning needs a configured API:** `--pin-ipfs` is a no-op (with a loud
  warning, no `proofsCid`) unless `$IPFS_API_URL` is set. The default
  `HttpPinner` targets a Pinata-/Kubo-compatible endpoint; swap in any `Pinner`
  implementation via the library API for other providers.
- **Reorgs:** the tool reads at a fixed `--record-block`; run it only once that
  block is final on your chain.
- **Index assignment vs. `Seed.s.sol`:** this CLI assigns `index` by **address
  ascending** (the deterministic, reproducible rule). The dev `Seed.s.sol`
  fixture assigned indices in insertion order. Both are internally consistent and
  both verify on-chain — but because `index` is part of the leaf, a fresh CLI
  snapshot will **not** bit-match the hand-rolled `proofs-31337-1.json` fixture
  (the eligible *set*, `totalPayout`, and the on-chain claim semantics are
  identical; only the per-holder index/root encoding differs). The CLI is the
  source of truth for production runs; `verify` re-derives and validates either
  artifact under the contract's exact rule.

---

## Environment variables

| Var             | Used by      | Meaning                                                            |
| --------------- | ------------ | ----------------------------------------------------------------- |
| `RPC_URL`       | `snapshot`   | Read RPC endpoint (overridden by `--rpc`).                         |
| `IPFS_API_URL`  | `--pin-ipfs` | Base URL of an IPFS pinning API. Unset ⇒ no-op pin + warning.      |
| `IPFS_API_KEY`  | `--pin-ipfs` | Optional bearer token / JWT for the pinning API.                  |
| `IPFS_API_PATH` | `--pin-ipfs` | Optional endpoint path (default `/pinning/pinFileToIPFS`).        |

## Library API

The package also exports its internals for reuse (see `src/index.ts`):
`generateSnapshot`, `serializeProofs`, `deriveHolders`, `sumPayout`, `sumGross`,
`foldTransfers`, `buildProofs`, `canonicalLeaf`, `verifyLeaf`, `verifyProofs`,
and `RpcBalanceProvider`; the extension helpers `applyExclusions`,
`normalizeExclusions`, `netFromGross`, `assertBps`; and the pinning seam
`resolvePinner`, `HttpPinner`, `NoopPinner`, `extractCid` + the `Pinner`
interface. The `BalanceProvider` seam lets callers inject a balance map (e.g. for
tests) instead of hitting an RPC; the `Pinner` seam does the same for IPFS.

---

## Tests

`npm test` runs these pillars under vitest:

1. **Canonical encoding** (`merkle.test.ts`) — the OZ tree's leaf equals the
   explicit double-keccak of `abi.encode(actionId,index,account,amount)`, and
   every proof verifies against the root.
2. **JS↔Solidity parity** (`parity.test.ts`) — loads the real
   `deployments/proofs-31337-1.json` (written by `Seed.s.sol`) and verifies each
   proof under the **same** rule the contract uses — proving a JS-served proof
   will clear `claim()` on-chain.
3. **Determinism + pipeline** (`snapshot.test.ts`) — same input twice ⇒ same
   root and byte-identical artifact; order-independence; a 500-holder set; the
   fold/derive/total math.
4. **Eligibility math** (`eligibility.test.ts`) — exclusion set normalisation +
   filtering (input untouched, `applied` subset) and withholding net math
   (`net = gross*(10000-bps)/10000`, floor division, range guards).
5. **Extensions end-to-end** (`extensions.test.ts`) — excluded address absent
   from `claims`/totals and indices dense; withholding leaf=net + `grossAmount`
   recorded + `totalPayout = Σ net`; both extensions pass the `verify` gate;
   tamper detection on the net cross-check; backward-compat (plain run omits all
   new fields and stays deterministic).
6. **IPFS pinning** (`pin.test.ts`) — env-based `Pinner` selection, the
   no-op stub's warning, `HttpPinner` POST flow against an injected `fetch`
   (Pinata + Kubo response shapes, error paths), and CID extraction.
