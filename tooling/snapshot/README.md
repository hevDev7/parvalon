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
  --out        ../../deployments/proofs-31337-1.json
```

| Flag             | Required | Meaning                                                          |
| ---------------- | :------: | --------------------------------------------------------------- |
| `--rpc <url>`    |    △     | RPC endpoint. Falls back to `$RPC_URL`.                         |
| `--token <addr>` |    ✓     | ERC20 asset to snapshot.                                         |
| `--deploy-block` |    ✓     | Token deploy block — lower bound of the `eth_getLogs` scan.      |
| `--record-block` |    ✓     | Record block — the snapshot height (inclusive).                 |
| `--rate <wei>`   |    ✓     | `ratePerShare` in wei (per `1e18` shares).                      |
| `--action-id`    |    ✓     | Corporate-action id this snapshot is for (binds the leaves).    |
| `--out <path>`   |    ✓     | Output path for `proofs.json`.                                  |
| `--chunk <n>`    |          | `eth_getLogs` page size in blocks (default `5000`).            |
| `--payout-token` |          | Payout token address written into the artifact.                |
| `--chain-id`     |          | Override the chain id (default: read from the RPC).            |

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
3. **Filter** — keep `balance > 0`.
4. **Sort** — by address ascending (numeric order of the 20-byte value). This
   fixes the `index` (also the on-chain bitmap slot) and makes the run
   reproducible.
5. **Amount** — `amount = balance * ratePerShare / 1e18` (floor division).
6. **Tree** — `StandardMerkleTree.of(rows, ["uint256","uint256","address","uint256"])`
   with rows `[actionId, index, account, amount]` (INTEGRATION.md §4).
7. **Emit** — `corporax-merkle-v1` JSON: per-holder `{index, amount, proof}`
   keyed by lowercase address, plus `merkleRoot` and `totalPayout = Σ amount`.

### Determinism

Two runs over the same chain state produce a **byte-identical** artifact: the
holder set is sorted deterministically, OZ assigns tree positions by leaf hash
(so the root depends only on the leaf *set*), and we serialise with a fixed
2-space indent + trailing newline. The test suite asserts this directly,
including that input map **order** does not affect the root.

### Notes / honest limitations

- **Zero-amount leaves:** a holder with a positive balance whose payout floors to
  `0` under the rate is still included (`amount: 0`) to keep indices stable; the
  contract simply transfers 0 on claim.
- **No exclusion list:** every address with `balance > 0` is included, including
  contracts (LP/escrow). Per PRD §D7 this is acceptable for the hackathon; a
  production deployment would add a configurable exclusion list. *(demo scope)*
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

## Library API

The package also exports its internals for reuse (see `src/index.ts`):
`generateSnapshot`, `serializeProofs`, `deriveHolders`, `foldTransfers`,
`buildProofs`, `canonicalLeaf`, `verifyLeaf`, `verifyProofs`, and
`RpcBalanceProvider`. The `BalanceProvider` seam lets callers inject a balance
map (e.g. for tests) instead of hitting an RPC.

---

## Tests

`npm test` runs three pillars under vitest:

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
