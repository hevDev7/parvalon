<p align="center">
  <img src="logo-parvalon.png" alt="Parvalon" width="120" />
</p>

<h1 align="center">Parvalon</h1>

**The missing corporate-actions layer for tokenized stocks** — on-chain dividends, splits, and record-date semantics for the tokens that already exist. A permissionless **overlay** that works on tokenized stocks you don't control: no token changes, no issuer integration.

> Built on **Robinhood Chain** (Arbitrum Orbit L2, chainId 46630) for the Arbitrum Open House London Buildathon.
>
> **Live now:** all five real Robinhood tokenized stocks (TSLA, AMZN, PLTR, NFLX, AMD) have a funded, **CLAIMABLE** dividend on-chain — ~917,571 holders snapshotted, ≈13.61M USDG funded, claims settled. Click-verify in **[Live corporate actions](#live-corporate-actions-on-chain-proof)**.

## The problem

Tokenization solved **issuance and trading** for ~2,000 tokenized stocks — but not what happens *after* a share is minted: **dividends, splits, record dates**. A holder of a tokenized share today has **no on-chain rail to receive a dividend**, DeFi has **no signal** when a stock splits or goes ex-dividend (a real risk once RWAs are collateral), and agents have **no machine-readable feed**. Parvalon is that missing corporate-actions layer.

## How it works

A focused, immutable, **two-contract** protocol plus off-chain tooling:

1. **Announce** a corporate action with correct record-date semantics (`CorporateActionRegistry`).
2. **Snapshot** every holder's balance at the record block from on-chain `Transfer` logs, build a Merkle tree, and **publish the root** — anyone can reproduce it.
3. **Fund & claim** pro-rata dividends in USDG against that root — O(1) gas, **claim-on-behalf** (relayable / gasless).
4. **Consume** the standardized **[CAE-1](docs/CAE-1.md)** event stream + a `GET /api/actions` feed, so DeFi and AI agents can react.

It's an **overlay, not an integration**: snapshots reconstruct the holder set of *any* standard ERC-20 via `eth_getLogs`, so Parvalon runs on the real Robinhood tokens with nothing required from the issuer. Splits are emitted as informational signals (we can't rebase tokens we don't own). The **registry governs state** and never touches value; the **distributor custodies and settles** it. Record dates use the true L2 height via the **ArbSys precompile** (raw `block.number` on Orbit is the L1 number). Full rationale: **[ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Live corporate actions (on-chain proof)

All five real Robinhood tokenized stocks have a funded, CLAIMABLE cash dividend on Robinhood Chain testnet — holders snapshotted from public `Transfer` logs (record block `75361177`; TSLA at `75293412`), Merkle root published on-chain, then funded in USDG. **~917,571 holder positions, ≈13.61M USDG funded**, with real claims settled on-chain (claim-on-behalf pays the holder; anyone can submit). Click-verify on Blockscout:

| Stock | Action | Holders @ record | Funded (USDG) | Verify on-chain |
|---|---|---|---|---|
| TSLA | #2 | 184,143 | 2,721,462 | [publish](https://explorer.testnet.chain.robinhood.com/tx/0x732a573797902ed7e49c7c4c6320da8d8df4d208004d5af3fa2e88ec1a6e1e89) · [fund](https://explorer.testnet.chain.robinhood.com/tx/0x1088c97881d58fc7b31549b84c00060b64ae28fbc8210821244510a6a6bee3ea) · [claim](https://explorer.testnet.chain.robinhood.com/tx/0x8bf17424b996329b891e4e2a3c4de19982cb69203cab5ed2bca92d876cb31329) |
| AMZN | #4 | 183,324 | 2,722,317 | [announce](https://explorer.testnet.chain.robinhood.com/tx/0x39198dfb58b2bec02640ce8bb65ab7025bf05865476667c0205c539794323a7c) · [publish](https://explorer.testnet.chain.robinhood.com/tx/0x0e4f8ce770d68f4e8b423e0890433683892b2807fcf8038cf7dcf658af090eda) · [fund](https://explorer.testnet.chain.robinhood.com/tx/0x16f58d3ec91218743c53f0c81170d933132f3635d4f91c2f6e820a95f7236bf7) · [claim](https://explorer.testnet.chain.robinhood.com/tx/0xd4c64d992f518a8fd56eab085d54e2a87d435ca2f111020695b43e0a0ab7bf72) |
| PLTR | #5 | 183,918 | 2,722,317 | [announce](https://explorer.testnet.chain.robinhood.com/tx/0xf3ef329ac4f5570ed87ae4d12ffe00b35640139d8b04811196cbc44dc5a773a0) · [publish](https://explorer.testnet.chain.robinhood.com/tx/0xde185695ca3f3962517423e75f40e3a991d02a8d6bc4f276918a63b5749775fb) · [fund](https://explorer.testnet.chain.robinhood.com/tx/0x8df5dc85725726b9dc917db53f8817d8bbf96b78850004c05da01e490ee5b5f3) |
| NFLX | #6 | 182,602 | 2,722,317 | [announce](https://explorer.testnet.chain.robinhood.com/tx/0xb7dc1ee3c8759f4744b9dab3d6f32ef02d501e7329a7aec17e7f705527b8fbad) · [publish](https://explorer.testnet.chain.robinhood.com/tx/0x69c324a3338af085e68bbb772258d8892fabeb2442e2ac26a60005659b1401ba) · [fund](https://explorer.testnet.chain.robinhood.com/tx/0xb45556546f53fe2e88962aa55cbec040be3bfd96f767395510b7acbc29e6cf80) |
| AMD | #7 | 183,584 | 2,722,317 | [announce](https://explorer.testnet.chain.robinhood.com/tx/0xa455a79a922c0353b1c0cacb0d4d47972ae5ac678d0d16dca99427007ec8924c) · [publish](https://explorer.testnet.chain.robinhood.com/tx/0x24c9f3d20313c7f83d96ed28e71d9111e6a51fe6254d9ff933c4f635e53320b0) · [fund](https://explorer.testnet.chain.robinhood.com/tx/0x1dfda3447cf9d150d747c0d5ae5ada43206e7cc1005fd7601541cec370bf2b2f) |

Merkle roots (re-derivable from public `Transfer` logs with `npm run snapshot` — byte-identical):
`TSLA 0x8690a30781156045c5088dc89ab743a79f73cee51764072ac6e29164c53b55f0` · `AMZN 0x547c7199f6d2f4fbbc01ad1c29b112b92d363569aa0ae1142a3bf2966336aa4b` · `PLTR 0xcc7c9c6c946bf0d6ddd756c61679101aba2c00442ebe1c7fd78d879714674e24` · `NFLX 0xd9cd7c4cecb105e41a4577829458dca025f48c3735d5d4a947fb5749d11a53aa` · `AMD 0x9b6077458d8697a7744a1facf09a2a5ecd476454e2ce8a4a66735250734125c0`

> Holder counts include **every** non-zero balance at the record block (no testnet exclusion list). These tickers don't pay real-world dividends — amounts are **illustrative**; the protocol is asset/amount-agnostic. Payout settles in faucet-mintable mock USDG (real USDG faucet is rate-limited); per-holder proofs are served by `GET /api/proof` so a 184k-holder set never ships to the browser.

## Contract addresses (Robinhood Chain testnet, 46630)

Authoritative copy: [`deployments/46630.json`](deployments/46630.json). Explorer: [`explorer.testnet.chain.robinhood.com`](https://explorer.testnet.chain.robinhood.com).

| Contract | Address |
|---|---|
| `CorporateActionRegistry` | [`0xE3d21a220400BB523d77852fA5bc706dcc8c4e90`](https://explorer.testnet.chain.robinhood.com/address/0xE3d21a220400BB523d77852fA5bc706dcc8c4e90) |
| `DividendDistributor` | [`0xbbCeD23e5900aBd0F0B67c34769D3f04340e426A`](https://explorer.testnet.chain.robinhood.com/address/0xbbCeD23e5900aBd0F0B67c34769D3f04340e426A) |
| `AdminActionSource` (oracle seam, v1) | [`0xB3Ae014A3d052d6350E48B46194CA9D1fdD17a78`](https://explorer.testnet.chain.robinhood.com/address/0xB3Ae014A3d052d6350E48B46194CA9D1fdD17a78) |
| USDG payout (mock, faucet-mintable, 6-dec) | [`0x6e61B4444f40FBc0a7725c29572cC014b76064f5`](https://explorer.testnet.chain.robinhood.com/address/0x6e61B4444f40FBc0a7725c29572cC014b76064f5) |
| Stocks (real) | TSLA `0xC9f9…Bd4E` · AMZN `0x5884…9E02` · PLTR `0x1FBE…98d0` · NFLX `0x3b82…8C93` · AMD `0x7117…778d` |

> The dApp defaults to chainId 46630 and uses real Robinhood stock tokens; the payout token defaults to a faucet-mintable mock USDG (the real USDG faucet is rate-limited). Local anvil (31337) and Arbitrum Sepolia configs live in `deployments/`.

## Quickstart (local, ~2 min)

Requires [Foundry](https://book.getfoundry.sh/) (`anvil`/`cast`/`forge`) and Node ≥ 20.

```bash
npm run anvil          # local chain on 127.0.0.1:8545 (chainId 31337)
npm run deploy:local   # deploy protocol + mock TSLA/AMZN/USDG
npm run seed:local     # announce → publish → fund a CLAIMABLE TSLA dividend + proofs.json
npm run dev            # dApp — defaults to live Robinhood Chain (46630), zero-config
```

Live deploy + the production snapshot path (over real `Transfer` logs): **[RUNBOOK.md](docs/RUNBOOK.md)**.

## Evidence

```bash
npm run test:contracts   # 84 Foundry tests (unit + fuzz + invariants)
npm run test:ts          # 166 TS tests (sdk / snapshot / monitor / agent / functions)
```

**84 Foundry tests** pass (fuzz + invariants: solvency `balance == funded − claimed`, no overpayment), **166 TS tests** pass, **Slither 0 high / 0 medium**. Immutable contracts — no proxy, no `delegatecall`, no upgrade key. Solidity 0.8.26, OpenZeppelin v5.1.0. The Merkle root is deterministic and re-derivable from public logs — auditability traditional transfer agents don't offer.

## Docs

The deployed dApp serves an in-app **/docs** page; the Markdown suite lives in [`docs/`](docs/):
**[ARCHITECTURE](docs/ARCHITECTURE.md)** · **[INTEGRATION](docs/INTEGRATION.md)** (frozen contract) · **[CAE-1](docs/CAE-1.md)** + [EIP draft](docs/eip/eip-cae1.md) · **[RUNBOOK](docs/RUNBOOK.md)** · **[THREAT-MODEL](docs/THREAT-MODEL.md)** · **[LIMITATIONS](docs/LIMITATIONS.md)** · **[PRODUCTION-READINESS](docs/PRODUCTION-READINESS.md)** · **[PRD](PRD-Parvalon.md)**.

## License

MIT — see [LICENSE](LICENSE).
