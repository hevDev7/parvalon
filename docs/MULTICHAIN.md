# Parvalon — Multichain Deploy & Deployment Registry

> Per-chain deployment and the on-disk registry layout. Parvalon targets three
> chains ([INTEGRATION §8](./INTEGRATION.md#8-chains)); the same bytecode deploys
> to each, and `deployments/chains.json` is the machine-readable map that tooling
> resolves a chain by. Pair with [DEPLOY.md](./DEPLOY.md).

---

## 1. The chains

| chainId | name | alias | type | rpcEnv | explorer / verifier | tokens |
|---|---|---|---|---|---|---|
| 46630 | Robinhood Chain testnet | `robinhood_testnet` | **primary** | `ROBINHOOD_TESTNET_RPC_URL` | Blockscout `explorer.testnet.chain.robinhood.com` | real |
| 421614 | Arbitrum Sepolia | `arbitrum_sepolia` | **fallback** | `ARBITRUM_SEPOLIA_RPC_URL` | Arbiscan `sepolia.arbiscan.io` | mock |
| 31337 | Local anvil | `localhost` | **local** | `LOCAL_RPC_URL` (default `http://127.0.0.1:8545`) | — | mock |

Robinhood Chain is an **Arbitrum Orbit L2**; Arbitrum Sepolia is its public
fallback for rehearsal; anvil is for dev. Native currency is ETH on all three.

---

## 2. `deployments/chains.json` (the registry index)

`deployments/chains.json` (schema `corporax-chains-v1`) maps `chainId →` deploy
metadata. It holds **no secrets** — only the *names* of env vars (`rpcEnv`,
`verifierApiKeyEnv`, …); tooling reads the values from the environment at runtime.

```jsonc
{
  "chains": {
    "46630": {
      "name": "Robinhood Chain testnet",
      "alias": "robinhood_testnet",
      "rpcEnv": "ROBINHOOD_TESTNET_RPC_URL",     // env var holding the RPC URL
      "explorer": "https://explorer.testnet.chain.robinhood.com",
      "explorerApi": ".../api",
      "verifier": "blockscout",
      "verifierApiKeyEnv": "BLOCKSCOUT_API_KEY",
      "verifierApiUrlEnv": "ROBINHOOD_BLOCKSCOUT_API_URL",
      "type": "primary",                          // primary | fallback | local
      "nativeCurrency": "ETH",
      "stack": "arbitrum-orbit-l2",
      "deploymentFile": "deployments/46630.json", // where addresses are written
      "tokenMode": "real"                         // real | mock
    }
    // ... 421614 (fallback), 31337 (local)
  }
}
```

Resolve a chain in shell:

```bash
jq -er '.chains["46630"].rpcEnv'         deployments/chains.json   # -> ROBINHOOD_TESTNET_RPC_URL
jq -er '.chains["46630"].deploymentFile' deployments/chains.json   # -> deployments/46630.json

# Dereference the env var (bash indirect expansion via a temp var):
RPC_ENV="$(jq -er '.chains["46630"].rpcEnv' deployments/chains.json)"
RPC_URL="${!RPC_ENV}"   # -> the actual URL held in $ROBINHOOD_TESTNET_RPC_URL
```

---

## 3. Deployment registry layout (on disk)

Everything per-chain is keyed by `chainId`, so multiple chains coexist in one
`deployments/` directory without collision:

```
deployments/
├── chains.json                       # this index (chainId -> metadata)
├── <chainId>.json                    # address registry (INTEGRATION §6)
│     e.g. 46630.json, 421614.json, 31337.json
├── governance-<chainId>.json         # timelock + Safe + minDelay (post-handover)
├── functions-source-<chainId>.json   # FunctionsActionSource address + DON config
├── proofs-<chainId>-<actionId>.json  # canonical corporax-merkle-v1 proofs (INTEGRATION §5)
└── manifests/
      └── <alias>-<chainId>.json      # signed deploy manifest (addresses+tx+commit+compiler)
```

- **`<chainId>.json`** is the frozen address registry every package reads:
  `{registry, distributor, actionSource, usdg, tsla, amzn, admin, issuer}`.
  Source of truth for the *current* action source is always the on-chain
  `registry.actionSource()` (the file's `actionSource` is the deploy-time value;
  it can go stale after a `setActionSource` swap — see [DEPLOY §3](./DEPLOY.md)).
- **`manifests/`** is provenance: it pins the exact commit + compiler + tx hashes
  and is signed by the deployer (verify with `cast wallet verify`).

---

## 4. Per-chain deploy

Identical scripts, different network arg (they read `chains.json` semantics via
`foundry.toml` profiles). See [DEPLOY.md](./DEPLOY.md) for the full flow.

```bash
# Primary
scripts/deploy-and-verify.sh robinhood_testnet
# Fallback rehearsal
scripts/deploy-and-verify.sh arbitrum_sepolia
# Local dev (no verify)
anvil &                       # or: npm run anvil
scripts/deploy-and-verify.sh localhost
```

`foundry.toml` already wires per-chain RPC + verifier profiles from the env:

```toml
[rpc_endpoints]
robinhood_testnet = "${ROBINHOOD_TESTNET_RPC_URL}"
arbitrum_sepolia  = "${ARBITRUM_SEPOLIA_RPC_URL}"
localhost         = "http://127.0.0.1:8545"

[etherscan]
robinhood_testnet = { key = "${BLOCKSCOUT_API_KEY}", url = "${ROBINHOOD_BLOCKSCOUT_API_URL}", chain = 46630 }
arbitrum_sepolia  = { key = "${ARBISCAN_API_KEY}", chain = 421614 }
```

Deterministic bytecode across chains is guaranteed by `bytecode_hash = "none"`,
`cbor_metadata = false`, a pinned `solc 0.8.26`, and `optimizer_runs = 200` — so
the same source verifies identically on Blockscout and Arbiscan.

---

## 5. Adding a new chain

1. Add a `chainId` entry to `deployments/chains.json` (name, alias, `rpcEnv`,
   explorer, verifier, `type`, `tokenMode`).
2. Add `[rpc_endpoints]` + `[etherscan]` profiles to `contracts/foundry.toml`
   keyed by the alias.
3. Add the `rpcEnv` (and any verifier key env) to `.env.example`.
4. Extend the `case "$NETWORK"` block in `scripts/deploy-and-verify.sh`.
5. `scripts/deploy-and-verify.sh <alias>` → produces `deployments/<chainId>.json`
   + a signed manifest.

Governance, monitoring, DR, and onboarding are chain-agnostic — they all resolve
addresses from `deployments/<chainId>.json` by the RPC's reported chain id.
