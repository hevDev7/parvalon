# @parvalon/example-agent

A runnable example of a **dividend-aware autonomous agent** for Parvalon. It
subscribes to the registry's `ActionAnnounced` event (the CAE-1 announcement,
see [`docs/eip/eip-cae1.md`](../../docs/eip/eip-cae1.md)) and prints
**strategy decisions** — e.g.

```
── action #1  [CASH_DIVIDEND]  HELD ──
   decision: cash-dividend-flag-and-claim
   eligible claim: 7 payout-token units
   • CASH_DIVIDEND announced for 0xe7f1…0512 (action #1).
   • Record block 1234 — flag this position for ex-dividend.
   • Held 14 units @ rate 0.5 => pre-computed eligible claim 7 payout-token units.
   • Funds settle to the holder via claim-on-behalf; the agent only triggers it.
   next:
     → Subscribe to ActionStatusChanged(#1); when newStatus == CLAIMABLE, fetch …
     → Call DividendDistributor.claim(1, index, account, amount, proof) before …
     → Mark the position as going ex-dividend at record block 1234 for valuation.
```

This is an **example consumer** for the CAE-1 standard. It is intentionally
small and honest: the decision logic is real and tested; the live subscription
is real viem; the premium-feed payment is a clearly-labeled illustrative stub.

## Why this is the agent-native use case

CAE-1 gives an agent three things that compose into an autonomous loop:

1. a **uniform event stream** (`ActionAnnounced`, `ActionStatusChanged`, …),
2. an off-chain **`/api/actions` feed** + per-holder `proofs.json`, and
3. **claim-on-behalf** — `DividendDistributor.claim(id, index, account, amount, proof)`
   settles funds to `account` regardless of `msg.sender`.

So an agent can **detect** an announcement, **decide** a strategy, and **execute
the claim for its principal** — without ever holding the principal's keys.

## Quick start

```bash
npm install
npm run typecheck
npm run build

# Zero-dependency "see it work" path: synthetic events, no chain.
npm start          # == node dist/cli.js demo   (after build)
#  or, no build:
npx tsx src/cli.ts demo
```

`demo` runs the pure decision core over one synthetic event per `ActionType`
(cash dividend, split, stock dividend) against a book that holds 14 TSLA, then
runs the illustrative x402 flow.

## Live subscription

```bash
# Against a local anvil with the Parvalon contracts deployed (deployments/31337.json):
AGENT_HOLDINGS='{"0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512":"14000000000000000000"}' \
  npx tsx src/cli.ts watch
```

Config resolution (env first, then `deployments/<chainId>.json`):

| Variable | Meaning | Fallback |
|---|---|---|
| `NEXT_PUBLIC_RPC_URL` / `RPC_URL` | JSON-RPC endpoint | `http://127.0.0.1:8545` |
| `NEXT_PUBLIC_REGISTRY_ADDRESS` | registry address | `deployments/<chainId>.json` `registry` |
| `NEXT_PUBLIC_CHAIN_ID` | chain id | `deployments/<chainId>.json` `chainId` / `31337` |
| `AGENT_HOLDINGS` | JSON `{assetAddr: unitsString}` (1e18-scaled) | `{}` |

The env var names are the canonical ones from
[`docs/INTEGRATION.md` §9](../../docs/INTEGRATION.md). The agent subscribes via
viem `watchContractEvent` using the typed `registryAbi`.

## What each module does

| File | Responsibility |
|---|---|
| `src/types.ts` | CAE-1 `ActionType` / `ActionStatus` enums (frozen by INTEGRATION.md §2), decoded event + decision shapes. |
| `src/strategy.ts` | **The pure decision core** (`decideOnAnnouncement`). No I/O; this is the unit under test. |
| `src/agent.ts` | Config resolution + viem `watchContractEvent` subscription + log→event decoding. |
| `src/x402.ts` | Illustrative x402 pay-per-call narrative (**stub** — see below). |
| `src/cli.ts` | `demo` (synthetic, no chain) and `watch` (live) commands. |
| `src/abi.ts` | Vendored `registryAbi` (see *ABIs* below). |

## The decision logic

`decideOnAnnouncement(event, holdings)` is a **pure function** — that is what
lets it be unit-tested with a synthetic event and no live chain (`test/strategy.test.ts`).

- **`CASH_DIVIDEND`** — flag the position for ex-dividend; if held, pre-compute
  the exact eligible claim using the canonical leaf rule
  `amount = balanceAtRecordBlock * ratePerShare / 1e18`
  ([INTEGRATION.md §4](../../docs/INTEGRATION.md)), so the claim can be submitted
  the moment the action goes `CLAIMABLE`.
- **`STOCK_SPLIT`** — signal that the oracle / collateral factor must be rescaled
  at the record block, so a forward split is not mistaken for a price crash (cf.
  [`SplitAwareCollateral.sol`](../../contracts/src/examples/SplitAwareCollateral.sol)).
- **`STOCK_DIVIDEND`** — signal that the effective share count changes.
- **unknown `ActionType`** — ignored, per CAE-1's forward-compatibility rule.

## x402: pay-per-call premium feed (ILLUSTRATIVE STUB)

`src/x402.ts` sketches how an agent would pay **per call** for a premium feed via
[x402](https://www.x402.org) — HTTP `402 Payment Required` reborn as a
machine-native paywall.

> **This is a stub.** `payForData()` does not open a socket, does not move funds,
> and does not speak real x402. It models the four-step control flow and returns
> synthetic data so the example reads as a credible production sketch. Every step
> documents its production path inline.

The flow it models:

1. `GET {url}` with no payment → server replies **`402`** + a payment challenge
   (asset, price, recipient, network).
2. The agent enforces an autonomous **budget cap** against `maxAmountRequired`.
3. The agent **settles on-chain** (production: a viem `walletClient` stablecoin
   transfer, or an EIP-3009 `transferWithAuthorization` signature).
4. The agent **retries** with an `X-PAYMENT` header proving settlement → server
   verifies and returns `200` + the premium payload.

The natural Parvalon fit: the public `/api/actions` feed is free and
event-derived, but a value-added provider could gate a low-latency or enriched
feed (tax lots, ex-date forecasts, cross-venue holdings) behind x402 so the agent
pays per call, with no API keys or subscriptions.

## ABIs

This package is self-contained and npm-publishable, so it **vendors** the single
ABI it needs (`registryAbi`) into `src/abi.ts` as a verbatim, mechanically
extracted copy of the monorepo's auto-generated typed ABIs
([INTEGRATION.md §7](../../docs/INTEGRATION.md)) — the ABIs are never hand-written.

- **Production path (inside the monorepo):** import directly from the `abis/`
  workspace instead of vendoring.
- **Refresh after a contract change:** run the repo's `npm run abi`, then
  re-vendor with `node scripts/vendor-abi.mjs`.

## Tests

```bash
npm test
```

`test/strategy.test.ts` exercises the decision core, the log→event decoder,
config/holdings parsing, and the x402 stub — all with synthetic data, no live
chain.

## Scope & honesty

This is **example / reference** code, not a production trading agent. The
strategy outputs are advisory; wiring the printed "next actions" to real
transactions (fetching `proofs.json`, signing, submitting `claim`) is left to the
integrator. The x402 module is explicitly stubbed. See
[`docs/LIMITATIONS.md`](../../docs/LIMITATIONS.md) for the protocol's overall
scope boundaries.
