# @corporax/monitor

Monitoring & alerting service for the CorporaX corporate-actions protocol —
**P0-6** in [`docs/PRODUCTION-READINESS.md`](../../docs/PRODUCTION-READINESS.md).
It watches the protocol on-chain and **pages** when the solvency invariant breaks,
and **notifies** on lifecycle / funding / claim / sweep / pause anomalies.

> The goal of P0-6 is simple and load-bearing: an incident should be discovered
> by **operators**, not by users who can't claim their dividend. This service is
> the always-on eye on the value path.

Conforms to [`docs/INTEGRATION.md`](../../docs/INTEGRATION.md): it reads only via
the FROZEN ABIs (`abis/index.ts`, synced into `src/generated/abi.ts` — never
hand-written), subscribes to the CAE-1 events (§3), and resolves contract
addresses from `deployments/<chainId>.json` (§6).

---

## What it watches (PRODUCTION-READINESS.md §4)

| Signal | Source | Severity | Check |
|---|---|---|---|
| **Solvency drift** | per-token `balanceOf(distributor)` vs Σ`(funded − claimed)` over active actions | **page** | `checkSolvency` |
| Pause state change | `paused()` reads + `Paused`/`Unpaused` events | notify | `checkPauseChange` |
| Anomalous announcement | `ActionAnnounced` — implausible `ratePerShare`, unexpected asset | notify | `checkAnnounced` |
| Anomalous root | `MerkleRootPublished` — implausible `totalPayout`, 0 holders | notify | `checkRootPublished` |
| Funding anomaly | `Funded` — over-large single fund, duplicate tx, unexpected funder | notify | `checkFunded` |
| Illegal lifecycle | `ActionStatusChanged` outside the allowed DAG | notify | `checkStatusChanged` |
| Claim revert spike | `Claimed` rate vs observed reverts (rolling window) | notify | `ClaimHealthTracker` |
| Sweep anomaly | `UnclaimedSwept` — large remainder, early sweep | notify | `checkSwept` |

Normal lifecycle transitions, normal funding, and normal sweeps emit `info`.

### The solvency invariant (the page-worthy one)

The `DividendDistributor` holds **pooled** funds across all actions in one
contract, so there is no per-action balance to read. We therefore track the
**per-action accounting** (`totalFunded(id) − totalClaimed(id)`) and assert, **per
payout token**, that the distributor's ERC20 balance covers the sum of what every
still-active action owes:

```
obligation(token) = Σ_{active actions a paying in token} ( totalFunded(a) − totalClaimed(a) )

invariant:  balanceOf(distributor, token)  >=  obligation(token)
```

- "Active" = status in `{ANNOUNCED, ROOT_PUBLISHED, CLAIMABLE}`. After
  `FINALIZED` (a sweep) the remainder has been transferred to the issuer, so it
  no longer counts; `CANCELLED` actions never funded an obligation.
- The contract caps funding at `totalPayout` (`Overfunded`) and only ever pays
  the exact leaf `amount`, so a healthy distributor balance is `>=` the
  obligation. A surplus (stray transfer, dust from a prior finalized action) is
  fine. A **shortfall** (`balance < obligation`) means outstanding claims cannot
  all be honoured — that pages.

This is the runtime counterpart of the formal "Solvency" property in
PRODUCTION-READINESS.md §3.1.

---

## Install & build

npm workspace of the `corporax` monorepo. **Use npm, not pnpm** (pnpm is broken
on the dev machine). From this directory:

```bash
npm install
npm run typecheck   # tsc --noEmit (strict)
npm run build       # tsc -> dist/
npm test            # vitest (no chain required)
```

Each of `build` / `typecheck` / `test` / `start` runs `scripts/sync-abi.mjs`
first, which copies the canonical `abis/index.ts` into `src/generated/abi.ts`.
This is the same pattern `app/scripts/sync-shared.mjs` uses — the ABIs are
**generated, never hand-edited** here, so INTEGRATION.md §7 still holds.

---

## Run

The binary is `corporax-monitor` (after `npm run build`), or `npm start` in dev
(runs `src/cli.ts start` via `tsx`).

```bash
# Local anvil deployment (31337) — addresses resolved from deployments/31337.json:
RPC_URL=http://127.0.0.1:8545 CHAIN_ID=31337 npm start

# Explicit addresses + a webhook sink + page-only delivery:
corporax-monitor start \
  --rpc https://rpc.testnet.chain.robinhood.com \
  --chain-id 46630 \
  --registry 0x... --distributor 0x... \
  --webhook https://events.pagerduty.com/v2/enqueue \
  --min-severity notify

# One-shot health gate (CI / cron): exits non-zero on any solvency violation.
RPC_URL=$RPC_URL CHAIN_ID=31337 corporax-monitor check
```

### Commands

- **`start`** — poll loop (solvency + pause every `--interval` ms) **plus** an
  event subscription (CAE-1 lifecycle / funding / claim / sweep). Handles
  `SIGINT`/`SIGTERM` for clean shutdown.
- **`check`** — a single solvency/state sweep; prints per-token results to
  stderr and `OK` / `VIOLATION` to stdout; exit code reflects the result. Use it
  as a Kubernetes liveness probe or a cron canary.

---

## Configuration

Precedence: **CLI flags > environment > `deployments/<chainId>.json` > defaults.**

| Env var | Flag | Default | Meaning |
|---|---|---|---|
| `RPC_URL` | `--rpc` | — (required) | RPC endpoint. `ws(s)://` enables push events; `http(s)://` uses viem's poll-based watch. |
| `CHAIN_ID` | `--chain-id` | — | Chain id; also keys the deployments lookup. |
| `REGISTRY_ADDRESS` | `--registry` | from deployments | Registry address. |
| `DISTRIBUTOR_ADDRESS` | `--distributor` | from deployments | Distributor address. |
| `POLL_INTERVAL_MS` | `--interval` | `30000` | Solvency/pause sweep cadence. |
| `ALERT_WEBHOOK_URL` | `--webhook` | — | Enables the webhook sink (POST JSON). |
| `MIN_SEVERITY` | `--min-severity` | `info` | Floor: `info` \| `notify` \| `page`. |
| `ALERT_COOLDOWN_MS` | — | `300000` | Per-condition de-dup window. |
| `DEPLOYMENTS_PATH` | `--deployments` | repo `deployments/<id>.json` | Explicit deployments file. |
| `EXPECTED_FUNDERS` | — | — | Comma-separated issuer allowlist; a `Funded` from outside it alerts. |

**Anomaly thresholds** (env, all optional):

| Env var | Default | Meaning |
|---|---|---|
| `MAX_RATE_PER_SHARE` | `1e24` | Ceiling on announced `ratePerShare` (wei/1e18 shares). |
| `MAX_TOTAL_PAYOUT` | `1e30` | Ceiling on published `totalPayout` (wei). |
| `LARGE_FUNDING_RATIO` | `1.0` | Single fund ≥ this share of `totalPayout` → notify. |
| `MAX_CLAIM_REVERT_RATE` | `0.25` | Window revert rate above this → notify. |
| `MIN_CLAIM_ATTEMPTS` | `8` | Min attempts before the revert rate is meaningful. |
| `LARGE_SWEEP_REMAINDER_RATIO` | `0.5` | Swept remainder ≥ this share of funded → notify. |
| `EARLY_SWEEP_WINDOW_SECS` | `0` (off) | Sweep earlier than this before `claimDeadline` → notify. |

---

## Alert sinks (`Notifier`)

Pluggable via the `Notifier` interface (`notify(alert): Promise<void>`):

- **`ConsoleNotifier`** (default) — severity-tagged lines on **stderr** plus the
  JSON details (bigints rendered as decimal strings). stdout stays clean for the
  `check` command's machine-readable result.
- **`WebhookNotifier`** — POSTs each alert as JSON to `$ALERT_WEBHOOK_URL`. The
  body envelope is `{ source, severity, code, title, key, details, at }` — map it
  at the receiver (PagerDuty Events v2, Slack/Discord incoming webhook, Opsgenie).
  A down or non-2xx webhook is **logged, never thrown** — the console sink is the
  durable record.
- **`CompositeNotifier`** — fans out to all sinks, applies the severity floor,
  and de-duplicates by `alert.key` within the cooldown so a *persistent* breach
  pages **once per window**, not every poll.

Add your own sink by implementing `Notifier` and passing it into
`CompositeNotifier`.

---

## Library use

The pure checks are exported for dashboards / tests / other tooling:

```ts
import {
  checkSolvency, type ActionAccounting, type TokenBalance,
  Monitor, resolveConfig, ConsoleNotifier, CompositeNotifier,
} from "@corporax/monitor";

const { results, alerts } = checkSolvency(actions, balances); // pure, no chain
```

`checks.ts` is deliberately I/O-free: every signal is a small function over a
plain data snapshot, which is what lets the test suite assert the invariant logic
without a live chain. `monitor.ts` does the reading; the checks decide.

---

## Architecture

```
cli.ts        start / check commands; builds the notifier; wires SIGINT/SIGTERM
config.ts     flag > env > deployments > default resolution + validation
monitor.ts    viem reads (actionCount→actionView→funded/claimed→balanceOf→paused),
              poll loop, CAE-1 event subscription; turns reads into check calls
checks.ts     PURE signal functions (solvency, lifecycle, funding, claim, sweep,
              pause) + ClaimHealthTracker — the unit-tested core
notifier.ts   Notifier interface + Console / Webhook / Composite sinks
types.ts      enums, severities, Alert, Thresholds, MonitorConfig
```

---

## Honest scope (what's production vs. demo)

- **Solvency, pause, announcement, root, funding, sweep, lifecycle checks** are
  production logic: pure, deterministic, fully unit-tested against constructed
  states. The on-chain read path is exercised end-to-end in `monitor.test.ts`
  with a mocked viem client.
- **Claim revert-rate** has a real rolling-window tracker, but a reverted
  `claim` emits **no event** — the chain only tells us about *successful* claims
  (`Claimed`). To observe reverts you must feed them in from a mempool / relayer
  receipt watcher via `Monitor.recordClaimRevert()`. That external feed is **not
  bundled** here (it belongs with the gasless/relayer infra, P1-4); the success
  side (`Claimed` → `recordClaimSuccess`) is wired automatically. Until a revert
  feed is connected, the spike alert is effectively dormant — this is called out
  so no one assumes reverts are being caught for free.
- **Event subscription** uses viem `watchContractEvent`. Over an HTTP RPC this is
  poll-based and can miss events during downtime; for production use a WebSocket
  RPC (`wss://`) and/or pair this with an indexer (P1-1) for gap-free history.
  The solvency invariant itself is **state-read**, not event-derived, so it is
  robust to missed events — it re-checks ground truth every poll.
- **Pause de-dup**: the poll loop owns the authoritative pause state (read each
  sweep). The event subscription also surfaces `Paused`/`Unpaused` live; the
  composite notifier's per-key cooldown coalesces the two so you aren't paged
  twice for one toggle.

---

## Docker

A `Dockerfile` builds a minimal Node 22 image running `corporax-monitor start`.

```bash
docker build -t corporax-monitor ../..  -f Dockerfile   # build context = repo root (needs abis/ + deployments/)
docker run --rm \
  -e RPC_URL=$RPC_URL -e CHAIN_ID=46630 \
  -e ALERT_WEBHOOK_URL=$ALERT_WEBHOOK_URL \
  corporax-monitor
```

The image needs the repo's `abis/` and `deployments/` directories at build time
(for the ABI sync and address resolution), so the **build context is the repo
root** — see the `Dockerfile` header.
