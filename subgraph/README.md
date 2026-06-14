# Parvalon Subgraph

A [Graph Protocol](https://thegraph.com) subgraph that indexes the Parvalon
**CAE-1 event stream** (`docs/INTEGRATION.md §3`) into a queryable GraphQL API.
It replaces ad-hoc `eth_getLogs` pagination for integrators and the public feed
at scale: announce/publish/status events from `CorporateActionRegistry` and
fund/claim/sweep events from `DividendDistributor` are folded into four
entities — `CorporateAction`, `Claim`, `Funding`, `Sweep`.

> The schema, event signatures, and enum names mirror the **FROZEN** integration
> contract. uint8 `actionType`/`status` are stored as their canonical string
> names; all token/share amounts stay as on-chain `BigInt` (wei).

## Layout

```
subgraph/
├── schema.graphql       # entities (CorporateAction, Claim, Funding, Sweep) + enums
├── subgraph.yaml        # manifest: 2 dataSources, 6 eventHandlers
├── networks.json        # per-network address + startBlock (robinhood / arbitrum-sepolia / local)
├── src/mappings.ts      # AssemblyScript handlers
├── abis/                # CorporateActionRegistry.json + DividendDistributor.json (copied from /abis)
├── allium-queries.sql   # parity dataset via Allium (production indexer alternative)
└── package.json         # graph-cli scripts
```

## Networks

`networks.json` keys are **Graph-Node network names**, not chainIds. Map them to
the chains in `INTEGRATION.md §8`:

| networks.json key  | Chain                              | chainId | Notes |
|--------------------|------------------------------------|---------|-------|
| `robinhood`        | Robinhood Chain testnet (primary)  | 46630   | Custom L2 — requires a **self-hosted Graph Node** configured for its RPC; not on hosted Studio. |
| `arbitrum-sepolia` | Arbitrum Sepolia (fallback)        | 421614  | Supported by Subgraph Studio. |
| `local`            | Local anvil (dev)                  | 31337   | Self-hosted Graph Node against `host.docker.internal:8545`. Pre-filled with the local deployment addresses. |

Before deploying, replace the `0x0…0` placeholders + `startBlock` in
`networks.json` with the real values from `deployments/<chainId>.json` (the
`registry` and `distributor` addresses) and the block the contracts were
deployed at (use the deploy-tx block so indexing doesn't scan from genesis).

## Build

Uses **npm** (not pnpm). Node 22.

```bash
cd subgraph
npm install                 # installs @graphprotocol/graph-cli + graph-ts
npm run codegen             # generates ./generated/** AssemblyScript types from ABIs + schema
npm run build:local         # graph build --network local  (writes addresses from networks.json)
# or: npm run build:sepolia / npm run build:robinhood
```

`graph codegen` reads `subgraph.yaml` + the ABIs and emits typed event/entity
classes under `generated/` that `src/mappings.ts` imports. `graph build`
compiles the mappings to WASM and validates the manifest end-to-end. The
`--network <key>` flag rewrites `subgraph.yaml`'s `source.address`,
`source.startBlock`, and `dataSources[].network` from `networks.json` in place
before building.

## Deploy

### A. Subgraph Studio (hosted — Arbitrum Sepolia fallback)

```bash
# one-time: get a deploy key from https://thegraph.com/studio and create a subgraph named "corporax"
npm run auth -- <DEPLOY_KEY>
npm run build:sepolia
npm run deploy:studio       # graph deploy --node https://api.studio.thegraph.com/deploy/ corporax
```

Studio prompts for a version label and returns a query URL once it syncs.

### B. Self-hosted Graph Node (Robinhood Chain 46630 / local anvil)

Robinhood Chain is a custom Orbit L2, so it must be served by your own Graph
Node. Point a Graph Node at the chain RPC, then:

```bash
# Graph Node, IPFS, and Postgres must be running (graph-node admin on :8020, IPFS on :5001).
# A reference docker-compose for graph-node lives at https://github.com/graphprotocol/graph-node/tree/master/docker
npm run codegen
npm run build:robinhood            # or build:local for anvil
npm run create:local               # registers subgraph name "corporax/corporax" on the node
npm run deploy:robinhood           # or deploy:local
```

The Graph Node's `config.toml` must declare the chain, e.g.:

```toml
[chains.robinhood]
shard = "primary"
provider = [{ label = "robinhood", url = "$ROBINHOOD_TESTNET_RPC_URL", features = [] }]
```

The network label in `config.toml` (`robinhood`) must match the `network` key
in `networks.json` / the manifest after `--network robinhood`.

## Query

Once synced, query the GraphQL endpoint (Studio URL, or
`http://localhost:8000/subgraphs/name/corporax/corporax` for a local node):

```graphql
# Feed of actions with funding/claim progress — the /api/actions shape, pre-aggregated.
{
  corporateActions(orderBy: createdAt, orderDirection: desc, first: 50) {
    id
    asset
    actionType          # "CASH_DIVIDEND" | "STOCK_SPLIT" | "STOCK_DIVIDEND"
    status              # "ANNOUNCED" | "ROOT_PUBLISHED" | "CLAIMABLE" | "FINALIZED" | "CANCELLED"
    ratePerShare
    recordBlock
    payableAt
    claimDeadline
    payoutToken
    merkleRoot
    totalPayout
    holderCount
    totalFunded
    totalClaimed
    metadataURI
    createdAt
  }
}
```

```graphql
# Everything about one action, including its claim/funding/sweep history (derived).
{
  corporateAction(id: "1") {
    status
    totalFunded
    totalClaimed
    claims(orderBy: timestamp, orderDirection: asc) {
      index account amount tx timestamp
    }
    fundings { from amount totalFunded tx }
    sweeps   { to amount tx }
  }
}
```

```graphql
# All claims paid to a given holder across every action.
{
  claims(where: { account: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" }) {
    action { id asset }
    index amount timestamp tx
  }
}
```

Amounts come back as wei strings; format to decimals at the presentation layer
(the public `/api/actions` feed does this — `INTEGRATION.md §10`).

## Allium alternative

`allium-queries.sql` reproduces the identical action + claim + funding + sweep
dataset from Allium's decoded-logs tables, for teams that prefer a warehouse
over running a Graph Node. It is the production indexer alternative named in the
spec. The file documents every table/column dependency to adjust per Allium
workspace, and decodes the same uint8 enums to the same canonical names.

## Verification status

Fully verified against `@graphprotocol/graph-cli@0.98.1` + `graph-ts@0.38.2`:

- `npm install` — 474 packages installed.
- `npm run codegen` — **Types generated successfully** (schema SDL parsed, both
  ABIs loaded, `generated/**` types emitted).
- `npm run build` — **Build completed**; AssemblyScript mappings compiled to
  `build/CorporateActionRegistry/CorporateActionRegistry.wasm`, manifest
  validated end-to-end.
- `npm run build:local` (`graph build --network local`) — networks.json address
  injection confirmed (registry/distributor addresses written into the manifest).
- `schema.graphql` / `subgraph.yaml` / `networks.json` / `package.json` all
  parse (GraphQL SDL, YAML, JSON).

`generated/` and `build/` are git-ignored build artifacts; re-run `npm install`
then `npm run codegen && npm run build` to regenerate.
