# Parvalon

**The missing corporate-actions layer for tokenized stocks. On-chain dividends, stock splits, and record-date semantics — for the tokens that already exist.**

> Built on **Robinhood Chain** (Arbitrum Orbit L2, chainId 46630) for the Arbitrum Open House London Buildathon.

> **Live on Robinhood Chain testnet.** The protocol is deployed against **real** Robinhood tokenized stocks and USDG — addresses in [Contract addresses](#contract-addresses), explorer [`explorer.testnet.chain.robinhood.com`](https://explorer.testnet.chain.robinhood.com).

> **Naming.** Formerly **Corporax** → now **Parvalon**. The rename is complete across the UI, this README, the npm workspace scope (`@parvalon/*`), the root package, the PRD (`PRD-Parvalon.md`), and the docs. A few frozen wire/format identifiers intentionally keep the legacy string for backward compatibility — most notably the Merkle artifact format `corporax-merkle-v1` (baked into every committed `proofs.json` and the leaf domain) and the `corporax-snapshot`/`corporax-monitor` CLI bin names. Those are format constants, not branding.

---

## The problem

There are roughly **2,000 tokenized stocks and ETFs** in the Arbitrum ecosystem today — TSLA, AMZN, PLTR, NFLX, AMD and more, live on Robinhood Chain testnet. Tokenization solved **issuance and trading**. It did **not** solve everything that happens *after* a share is minted: dividends, splits, stock dividends, record dates — the entire corporate-actions lifecycle.

If you actually hold a tokenized share today, there is:

- **No on-chain rail to receive a dividend.** No record date, no claim mechanism, no auditable proof of distribution.
- **No signal for DeFi.** A lending market using a tokenized stock as collateral has no idea when a 4:1 split happens. An AMM has no idea when a token goes ex-dividend. That is a real, systemic risk once RWAs are used as collateral.
- **No machine-readable feed for agents.** The on-chain agent economy can't react to corporate actions it can't read.

Corporate actions are the **operational services layer** that institutional tokenization still lacks. Parvalon builds exactly that layer.

## The one-liner

> *Parvalon is a permissionless corporate-actions and dividend protocol that works on tokenized stocks **we do not control** — no token changes, no issuer integration required.*

## What it is

A focused, immutable, two-contract protocol plus the off-chain tooling around it:

1. **Announce** a corporate action on-chain with correct **record-date semantics** (`CorporateActionRegistry`).
2. **Snapshot** every holder's balance at the record block from on-chain `Transfer` logs, build a Merkle tree, and **publish the root** — anyone can reproduce and verify it.
3. **Fund and claim** pro-rata cash dividends in USDG against that root, with **O(1) gas** per claim and **claim-on-behalf** so claims can be relayed, sponsored (gasless), or driven by agents (`DividendDistributor`).
4. **Consume** a standardized event stream — the draft **[CAE-1](docs/CAE-1.md)** schema — plus a `GET /api/actions` feed, so lending markets, AMMs and AI agents can finally react to corporate actions.

## The innovation: a permissionless overlay

The hard part of dividends on-chain is that you normally need to **own the token** — you add transfer hooks, you make it a rebasing or dividend-paying token, you require every issuer to integrate. That doesn't work for a Tesla token that Robinhood already deployed and that you have zero control over.

Parvalon inverts this. It is an **overlay**, not an integration:

- **Snapshot via `eth_getLogs`** reconstructs the holder set at any historical block. It works against *any* standard ERC-20 — permissionlessly, with no cooperation from the token contract.
- **Record-date semantics map 1:1** to how corporate actions actually work in traditional markets: ownership is fixed at a record date, then payment follows. Our snapshot block *is* the record date.
- **Splits and stock dividends are handled as informational actions** (standardized event + ratio metadata), because we honestly cannot rebase a token we don't control — and what integrators actually need is a *signal*, not a rebase.

The result: Parvalon runs on the **real** TSLA, AMZN, PLTR, NFLX and AMD tokens on Robinhood Chain, today, settling in **real USDG**, with nothing required from the token issuer. That is the whole point.

### Orbit detail: record dates on the right clock (ArbSys)

On Robinhood Chain (an Arbitrum Orbit L2), the raw EVM `block.number` returns the **L1** block height — which disagrees with the **L2** height the snapshot tooling (`eth_getLogs` / `eth_blockNumber`) keys on. A naive record-date guard comparing `recordBlock` against `block.number` would be permanently unsatisfiable. So `publishRoot` reads the true L2 height by static-calling the **ArbSys precompile** (`0x64`) `arbBlockNumber()`, and falls back to `block.number` on non-Arbitrum chains (local anvil):

```solidity
// CorporateActionRegistry.sol
address private constant ARB_SYS = 0x0000000000000000000000000000000000000064;

function _recordChainBlock() private view returns (uint256) {
    (bool ok, bytes memory ret) = ARB_SYS.staticcall(abi.encodeWithSignature("arbBlockNumber()"));
    if (ok && ret.length == 32) return abi.decode(ret, (uint256)); // L2 height on Orbit
    return block.number;                                            // fallback elsewhere
}
// publishRoot: require the record block is strictly in the past, on the L2 clock
uint256 nowBlock = _recordChainBlock();
if (nowBlock <= a.recordBlock) revert RecordNotTaken(id, a.recordBlock, nowBlock);
```

This keeps the on-chain guard and the off-chain snapshot on the **same clock**. It is covered by `OrbitRecordBlock.t.sol` (via `MockArbSys`) and verified live on 46630.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Parvalon dApp (Next.js 14)                  │
│   /claim · /issuer · /feed · /faucet · /docs                    │
│   /api/actions (CAE-1 JSON feed) · /api/relay-claim (gasless)   │
│   wagmi/viem · claim-on-behalf relay (FR-6) · coverage ticker   │
└───────────────┬─────────────────────────────────┬───────────────┘
                │ viem/wagmi                       │ read
                ▼                                  ▼
┌───────────────────────────┐      ┌──────────────────────────────┐
│ CorporateActionRegistry   │◄─────│  Snapshot CLI (TypeScript)   │
│  - announce/publish/state │ root │  - getLogs Transfer→balances │
│  - per-asset issuer roles │      │    at recordBlock (L2)       │
│  - record date via ArbSys │      │  - StandardMerkleTree+proofs │
│  - CAE-1 events           │      └──────────────────────────────┘
│  - IActionSource seam (D3)│
└────────────┬──────────────┘
             │ lifecycle (DISTRIBUTOR_ROLE)
             ▼
┌───────────────────────────┐      ┌──────────────────────────────┐
│ DividendDistributor       │◄────►│ USDG payout (6-dec)          │
│  - fund / claim / sweep   │      │ snapshot src: TSLA·AMZN·PLTR │
│  - Merkle verify + bitmap │      │ ·NFLX·AMD (read-only, 18-dec)│
└───────────────────────────┘      └──────────────────────────────┘
        Robinhood Chain Testnet — chainId 46630 — Blockscout explorer
```

The split is deliberate: the **registry governs state** (and never touches value), the **distributor custodies and settles value** (and is the only party allowed to advance an action into `CLAIMABLE`/`FINALIZED`). Authenticity of an announcement is gated by a pluggable **`IActionSource`** (D3 seam): the deployed v1 source is `AdminActionSource` (issuer-attested); `FunctionsActionSource` (Chainlink Functions DON) is the production drop-in. See **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full rationale, state machine, and sequence diagrams.

The dApp also surfaces a **coverage ticker** — a TradingView ticker-tape of underlying-equity prices (TSLA, AMZN, PLTR, NFLX, AMD plus market-context names MSFT, AAPL, NVDA, GOOGL, META, COIN, HOOD) — so the corporate-actions lifecycle is shown against the live market it settles against.

## Quickstart (local, ~2 minutes)

Everything below uses **real, working commands**. The local anvil deployment and proofs already committed in `deployments/` were produced exactly this way.

> Uses **npm** (this repo's package manager). Requires [Foundry](https://book.getfoundry.sh/) (`anvil`, `cast`, `forge`) and Node ≥ 20.

```bash
# 1. Start a local chain (terminal A)
npm run anvil          # anvil on 127.0.0.1:8545, chainId 31337

# 2. Deploy the protocol + mock TSLA/AMZN/USDG (terminal B)
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # well-known anvil acct #0 — local only, no real funds
npm run deploy:local   # writes deployments/31337.json

# 3. Seed a full CLAIMABLE TSLA dividend (announce → publish → fund) + proofs.json
npm run seed:local     # writes deployments/proofs-31337-1.json
```

That seeds action `id=1`: two holders owed **5.0** and **7.0** USDG (rate 0.5 USDG/share over 10 and 14 TSLA), **totalPayout = 12.0 USDG**, status `CLAIMABLE`.

> **Decimals.** The **local mock** USDG is 18-decimal, so the figures below end in `…000000000000000000`. On the **real chain (46630)** USDG is **6-decimal** — never hardcode 18 for payouts; use the payout token's real decimals (`PAYOUT_DECIMALS` / `tokenDecimals()` in `app/src/lib/tokens.ts`).

Now claim as the first holder, straight from `cast` — note **anyone can submit the claim; funds always go to `account`**:

```bash
DIST=$(jq -r .distributor deployments/31337.json)

# pull the holder's index, amount and proof out of the committed proofs.json
HOLDER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
INDEX=$(jq -r ".claims[\"${HOLDER,,}\"].index"  deployments/proofs-31337-1.json)
AMOUNT=$(jq -r ".claims[\"${HOLDER,,}\"].amount" deployments/proofs-31337-1.json)
PROOF=$(jq -r ".claims[\"${HOLDER,,}\"].proof | join(\",\")" deployments/proofs-31337-1.json)

cast send $DIST 'claim(uint256,uint256,address,uint256,bytes32[])' \
  1 $INDEX $HOLDER $AMOUNT "[$PROOF]" \
  --rpc-url http://127.0.0.1:8545 --private-key $PRIVATE_KEY

# verify the holder received 5.0 USDG (18-dec local mock)
cast call $(jq -r .usdg deployments/31337.json) 'balanceOf(address)(uint256)' $HOLDER \
  --rpc-url http://127.0.0.1:8545
# → 5000000000000000000
```

To run the **dApp** against the live testnet, `npm run dev` works zero-config (it defaults to chainId 46630 / Robinhood Chain). For the **production snapshot path** (against real `Transfer` logs instead of the seed shortcut) and testnet deployment, see the **[RUNBOOK](docs/RUNBOOK.md)**.

## Reproduce the tests & gas evidence

```bash
npm run test:contracts                       # 84 forge tests
npm run test:ts                              # 166 TS tests (sdk/snapshot/monitor/agent/functions-don)
cd contracts && forge test --gas-report      # per-function gas table
cd contracts && slither . --config-file slither.config.json   # static analysis
```

| Evidence | Result |
|---|---|
| Contract suite | **84 tests pass** (unit + fuzz + invariants + audit-regression), 0 failed, across 12 suites |
| TypeScript suites | **166 tests pass** — SDK 30, snapshot 57, monitor 52, agent 18, functions-don 9 |
| Static analysis | slither — **0 high / 0 medium** (see [AUDIT-PREP.md](docs/AUDIT-PREP.md)) |
| Fuzz coverage | Full announce→claim cycle fuzzed across holder counts; Merkle-root determinism fuzzed |
| Invariants | Solvency (`balance == funded − claimed`), claimed ≤ funded, funded capped — held over randomized claim orderings |
| **`claim()` gas** | **~82k** for a representative 2-holder claim (`test_Claim_GasUnderTarget` asserts `< 150k`; under the 90k PRD target) |
| Build | Solidity 0.8.26, OpenZeppelin v5.1.0, optimizer 200 runs, `evm_version = shanghai`, deterministic bytecode (`bytecode_hash = none`) |

The Merkle root is **deterministic and independently verifiable**: two runs of the snapshot CLI produce an identical root (fuzz-tested), and anyone can re-derive it from public `Transfer` logs. That is auditability traditional transfer agents don't offer.

## Monorepo map

| Path | What |
|---|---|
| `contracts/` | Foundry protocol — `CorporateActionRegistry`, `DividendDistributor`, `AdminActionSource` + `FunctionsActionSource` (D3 seam), `SplitAdjuster` lib, `TimelockController` governance script, mocks, **84 tests**, deploy/seed/governance scripts |
| `tooling/snapshot/` | `@parvalon/snapshot` — TypeScript (viem) deterministic Merkle snapshot CLI — exclusion lists, withholding, IPFS pinning |
| `tooling/monitor/` | `@parvalon/monitor` — solvency-invariant + lifecycle alerting service |
| `packages/sdk/` | `@parvalon/sdk` — typed client (reads/writes + CAE-1 watchers + Merkle claim builders) for integrators |
| `app/` | `@parvalon/app` — Next.js 14 dApp — `/claim`, `/issuer`, `/feed`, `/faucet`, `/docs`, `/api/actions`, `/api/relay-claim` (gasless), plus a TradingView coverage ticker |
| `functions/` | `@parvalon/functions-don` — Chainlink Functions DON source + simulate harness backing `FunctionsActionSource` (the production D3 oracle path), **9 tests** |
| `subgraph/` | The Graph subgraph indexing CAE-1 events (+ Allium SQL) |
| `examples/agent/` | `@parvalon/example-agent` — dividend-aware AI agent consuming CAE-1 (x402 narrative) |
| `abis/` | **Auto-generated** typed ABIs (`index.ts` `as const` + JSON). Import these; never hand-write ABIs. |
| `deployments/` | `<chainId>.json` address registries + `proofs-<chainId>-<id>.json` artifacts + `chains.json` |
| `docs/` | This documentation suite (see [below](#documentation)), incl. the [CAE-1 EIP draft](docs/eip/eip-cae1.md) |
| `scripts/` | `export-abi.sh`, `e2e.sh` (live protocol test), `deploy-and-verify.sh`, `drills.sh`, `onboard-issuer.sh`, `dr-restore.sh` |
| `infra/` + `.github/` | Docker, CI (forge + TS + frontend + slither + codeql + **live E2E**), Makefile |

## Contract addresses

### Robinhood Chain testnet (chainId 46630) — live deployment

Against **real** Robinhood tokenized stocks and USDG (`tokenMode: real`). Authoritative copy: [`deployments/46630.json`](deployments/46630.json). Explorer: [`explorer.testnet.chain.robinhood.com`](https://explorer.testnet.chain.robinhood.com).

| Contract | Address |
|---|---|
| `CorporateActionRegistry` | [`0xE3d21a220400BB523d77852fA5bc706dcc8c4e90`](https://explorer.testnet.chain.robinhood.com/address/0xE3d21a220400BB523d77852fA5bc706dcc8c4e90) |
| `DividendDistributor` | [`0xbbCeD23e5900aBd0F0B67c34769D3f04340e426A`](https://explorer.testnet.chain.robinhood.com/address/0xbbCeD23e5900aBd0F0B67c34769D3f04340e426A) |
| `AdminActionSource` (D3 oracle, v1) | [`0xB3Ae014A3d052d6350E48B46194CA9D1fdD17a78`](https://explorer.testnet.chain.robinhood.com/address/0xB3Ae014A3d052d6350E48B46194CA9D1fdD17a78) |
| USDG (real, payout, 6-dec) | [`0x7E955252E15c84f5768B83c41a71F9eba181802F`](https://explorer.testnet.chain.robinhood.com/address/0x7E955252E15c84f5768B83c41a71F9eba181802F) |
| TSLA (real) | [`0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`](https://explorer.testnet.chain.robinhood.com/address/0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E) |
| AMZN (real) | [`0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02`](https://explorer.testnet.chain.robinhood.com/address/0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02) |
| Admin / Issuer (EOA) | [`0x3c2143F402aaa26584a3c8AC546bb5Ea5330c907`](https://explorer.testnet.chain.robinhood.com/address/0x3c2143F402aaa26584a3c8AC546bb5Ea5330c907) |

> Live control is currently a **single EOA** (admin == issuer). The `TimelockController` + Gnosis Safe governance handover (`script/DeployGovernance.s.sol`) is implemented but **not yet deployed** on 46630 — see [LIMITATIONS.md](docs/LIMITATIONS.md) §8 and [PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md). PLTR/NFLX/AMD are wired in the dApp and onboardable, but the seeded demo dividend uses TSLA/AMZN.

### Local (anvil, chainId 31337) — committed dev deployment

| Contract | Address |
|---|---|
| `CorporateActionRegistry` | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| `DividendDistributor` | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` |
| `AdminActionSource` (D3 oracle) | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| USDG (mock, 18-dec) | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| TSLA (mock) | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| AMZN (mock) | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |

> These are deterministic anvil CREATE addresses; reproduce them with the quickstart. The authoritative copy is always `deployments/31337.json`.

### Arbitrum Sepolia (chainId 421614) — fallback

Not yet deployed. The deploy + verify procedure is in the **[RUNBOOK](docs/RUNBOOK.md)** / [MULTICHAIN.md](docs/MULTICHAIN.md); addresses are written to `deployments/421614.json` at deploy time.

## Networks

| Name | chainId | Token mode | Gas | Explorer |
|---|---|---|---|---|
| Robinhood Chain testnet (primary, **deployed**) | 46630 | real | ETH | Blockscout `explorer.testnet.chain.robinhood.com` |
| Arbitrum Sepolia (fallback) | 421614 | mock | ETH | `sepolia.arbiscan.io` |
| Local anvil (dev) | 31337 | mock | ETH | — |

The dApp defaults to **46630** (`NEXT_PUBLIC_CHAIN_ID`, default `46630`) and switches token wiring automatically: real Robinhood tokens on 46630, mock/env-configured tokens elsewhere.

## Documentation

The deployed dApp also serves a full developer/issuer **[/docs](app/src/app/docs/page.tsx)** page (16 sections, live contract addresses). The Markdown suite:

| Doc | What it covers |
|---|---|
| [INTEGRATION.md](docs/INTEGRATION.md) | **Frozen** cross-package integration contract — signatures, enums, leaf encoding, JSON schemas, env vars. The literal source of truth. |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, registry/distributor split, the Merkle-snapshot model and **why**, lifecycle state machine, the D3 oracle seam, gas design, trust assumptions, sequence diagrams. |
| [CAE-1.md](docs/CAE-1.md) | **Corporate Action Events v1** — the draft event standard: schemas, enumerations, the action feed, and how integrators consume it. |
| [RUNBOOK.md](docs/RUNBOOK.md) | Operator runbook — deploy/verify, the full announce→snapshot→publish→fund→claim cycle, key rotation, pause/sweep/emergency procedures, on-call checklist. |
| [THREAT-MODEL.md](docs/THREAT-MODEL.md) | Assets, actors, trust boundaries, STRIDE enumeration, each mitigation mapped to a contract control or test. |
| [PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md) | Prioritized (P0/P1/P2) roadmap — and a status table of what is now code-complete. |
| [AUDIT-PREP.md](docs/AUDIT-PREP.md) | Slither run + disposition, invariant coverage map, and the scope to hand an audit firm. |
| [DEPLOY.md](docs/DEPLOY.md) · [ONBOARDING.md](docs/ONBOARDING.md) · [MULTICHAIN.md](docs/MULTICHAIN.md) | Production deploy + verify, issuer onboarding, per-chain registry. |
| [KEY-MANAGEMENT.md](docs/KEY-MANAGEMENT.md) · [DR.md](docs/DR.md) | HSM/KMS custody; disaster recovery from on-chain state + artifacts. |
| [eip/eip-cae1.md](docs/eip/eip-cae1.md) | Draft EIP for the **CAE-1** Corporate Action Events standard. |
| [LIMITATIONS.md](docs/LIMITATIONS.md) | Honest current limitations and why each is acceptable for v1. |
| [DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md) | The <3-minute demo video script, mapped to the working flow. |
| [PRD-Parvalon.md](PRD-Parvalon.md) | Product requirements — scope, priorities, decision log. |

## Design principles

- **Immutable, no proxy, no `delegatecall`, no upgradeability** — two small contracts a judge or auditor can read end-to-end in ten minutes.
- **Custom errors, full NatSpec, an event for every state change** — OpenZeppelin v5 patterns throughout (`AccessControl`, `Pausable`, `ReentrancyGuard`, `SafeERC20`, `MerkleProof`, `BitMaps`).
- **Honest engineering.** Where v1 simplifies — issuer-fed oracle today vs. Chainlink Functions next; informational splits vs. rebasing; single-EOA control vs. timelock+Safe; testnet exclusion-list defaults — it is labeled as such, in [LIMITATIONS.md](docs/LIMITATIONS.md), with the production path written down.

## License

MIT. See [LICENSE](LICENSE) (or the SPDX header on every source file).
