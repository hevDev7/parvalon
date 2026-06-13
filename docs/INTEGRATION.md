# CorporaX — Integration Contract (FROZEN)

> Single source of truth for cross-package integration. Every package (contracts,
> snapshot CLI, frontend, indexer, infra) MUST conform to the names, shapes and
> encodings below. Contracts are deployed and verified against this spec.

## 1. Monorepo layout

```
arbitrum/
├── contracts/          Foundry — protocol (DEPLOYED, 81 tests green, claim ~82k gas)
├── tooling/snapshot/   TypeScript CLI (viem) — Merkle snapshot generator
├── app/                Next.js 14 — /claim /issuer /feed + /api/actions
├── abis/               AUTO-GENERATED ABIs (JSON + index.ts `as const`)  ← import these
├── deployments/        <chainId>.json address registries + proofs-*.json artifacts
├── infra/              Docker, monitoring, deploy ops
├── docs/               specs, runbooks, this file
└── scripts/            export-abi.sh, dev helpers
```

## 2. Contracts (the frozen API)

Solidity 0.8.26, OZ v5.1.0. Two immutable contracts + one swappable oracle.

### Status enum (uint8)
`ANNOUNCED=0, ROOT_PUBLISHED=1, CLAIMABLE=2, FINALIZED=3, CANCELLED=4`

### ActionType enum (uint8)
`CASH_DIVIDEND=0, STOCK_SPLIT=1, STOCK_DIVIDEND=2`

### CorporateActionRegistry — key signatures
```
announceAction(address asset, uint8 actionType, uint256 ratePerShare,
  uint64 recordBlock, uint64 payableAt, uint64 claimDeadline,
  address payoutToken, string metadataURI) returns (uint256 id)
publishRoot(uint256 id, bytes32 root, uint256 totalPayout, uint256 holderCount)
cancelAction(uint256 id)
getAction(uint256 id) returns (CorporateAction)   // full struct incl. metadataURI
actionView(uint256 id) returns (ActionView)        // gas-lean, no metadataURI
actionCount() returns (uint256)                    // ids run 1..actionCount
assetIssuer(address asset) returns (address)
actionSource() returns (address)
setAssetIssuer(address asset, address issuer)      // DEFAULT_ADMIN_ROLE
```
`CorporateAction` struct field order:
`(uint256 id, address asset, uint8 actionType, uint256 ratePerShare, uint64 recordBlock,
uint64 payableAt, uint64 claimDeadline, address payoutToken, bytes32 merkleRoot,
uint256 totalPayout, uint8 status, string metadataURI)`

### DividendDistributor — key signatures
```
fund(uint256 id, uint256 amount)                                   // issuer; approve first
claim(uint256 id, uint256 index, address account, uint256 amount, bytes32[] proof)  // anyone; pays `account`
sweepUnclaimed(uint256 id)                                          // issuer; after claimDeadline
isClaimed(uint256 id, uint256 index) returns (bool)
totalFunded(uint256 id) returns (uint256)
totalClaimed(uint256 id) returns (uint256)
registry() returns (address)
```

## 3. CAE-1 event schema (subscribe to these)

```
Registry.ActionAnnounced(uint256 indexed id, address indexed asset, uint8 actionType,
  uint256 ratePerShare, uint64 recordBlock, uint64 payableAt, uint64 claimDeadline,
  address payoutToken, string metadataURI)
Registry.MerkleRootPublished(uint256 indexed id, bytes32 root, uint256 totalPayout, uint256 holderCount)
Registry.ActionStatusChanged(uint256 indexed id, uint8 previousStatus, uint8 newStatus)
Distributor.Funded(uint256 indexed id, address indexed from, uint256 amount, uint256 totalFunded)
Distributor.Claimed(uint256 indexed id, uint256 index, address indexed account, uint256 amount)
Distributor.UnclaimedSwept(uint256 indexed id, address indexed to, uint256 amount)
```

## 4. Merkle leaf encoding (CANONICAL — do not change)

```
leaf = keccak256( bytes.concat( keccak256( abi.encode(actionId, index, account, amount) ) ) )
```
- ABI tuple types & order: `(uint256 actionId, uint256 index, address account, uint256 amount)`.
- This is the OpenZeppelin `StandardMerkleTree` double-hash. On-chain verification uses
  `MerkleProof.verify` (commutative / sorted-pair hashing) — OZ `@openzeppelin/merkle-tree`
  proofs verify against it by design.
- CLI MUST build with: `StandardMerkleTree.of(rows, ["uint256","uint256","address","uint256"])`
  where each row = `[actionId.toString(), index.toString(), account, amount.toString()]`.
- `amount = balanceAtRecordBlock * ratePerShare / 1e18` (assumes asset has 1e18 units).
- `index` is the holder's unique 0-based position; it is also the bitmap slot consumed.
- `totalPayout = Σ amount` over all eligible holders (the exact funding target).

## 5. proofs.json schema — `corporax-merkle-v1`

Both the CLI and `Seed.s.sol` emit this; the frontend reads it. `claims` is keyed by
**lowercase** holder address.
```json
{
  "format": "corporax-merkle-v1",
  "actionId": "1",
  "chainId": 46630,
  "asset": "0x..",
  "payoutToken": "0x..",
  "ratePerShare": "500000000000000000",
  "recordBlock": 1234,
  "merkleRoot": "0x..",
  "totalPayout": "12000000000000000000",
  "holderCount": 2,
  "leafEncoding": ["uint256 actionId","uint256 index","address account","uint256 amount"],
  "claims": {
    "0xabc...": { "index": 0, "amount": "5000000000000000000", "proof": ["0x..","0x.."] }
  }
}
```
File name: `deployments/proofs-<chainId>-<actionId>.json`.

## 6. deployments/&lt;chainId&gt;.json schema
```json
{ "chainId": 46630, "registry": "0x..", "distributor": "0x..", "actionSource": "0x..",
  "usdg": "0x..", "tsla": "0x..", "amzn": "0x..", "admin": "0x..", "issuer": "0x.." }
```
Local anvil (31337) deployment + proofs already exist for development.

## 7. ABIs

Import from `abis/index.ts`: `registryAbi`, `distributorAbi`, `actionSourceAbi`, `erc20Abi`
(all `as const` for viem/wagmi inference). JSON copies sit beside it. Regenerate with
`bash scripts/export-abi.sh` after any contract change. Frontend/CLI must NOT hand-edit ABIs.

## 8. Chains
| Name | chainId | gas | explorer |
|---|---|---|---|
| Robinhood Chain testnet (primary) | 46630 | ETH | Blockscout `explorer.testnet.chain.robinhood.com` |
| Arbitrum Sepolia (fallback) | 421614 | ETH | `sepolia.arbiscan.io` |
| Local anvil (dev) | 31337 | ETH | — |

## 9. Environment variables (canonical names)

**Contracts / deploy** — `PRIVATE_KEY`, `ADMIN_ADDRESS`, `ISSUER_ADDRESS`, `AUTO_ATTEST`,
`USDG_ADDRESS`, `TSLA_ADDRESS`, `AMZN_ADDRESS`, `ROBINHOOD_TESTNET_RPC_URL`,
`ARBITRUM_SEPOLIA_RPC_URL`, `BLOCKSCOUT_API_KEY`, `ROBINHOOD_BLOCKSCOUT_API_URL`, `ARBISCAN_API_KEY`.

**Snapshot CLI** — `RPC_URL` (read), plus CLI flags `--asset --record-block --rate --out`.

**Frontend** (`NEXT_PUBLIC_` = browser-exposed) — `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`,
`NEXT_PUBLIC_REGISTRY_ADDRESS`, `NEXT_PUBLIC_DISTRIBUTOR_ADDRESS`, `NEXT_PUBLIC_BLOCKSCOUT_URL`,
`NEXT_PUBLIC_ALCHEMY_API_KEY`, `NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID`. Server-only: `ALCHEMY_API_KEY`.

## 10. /api/actions response schema (frontend serves)
```json
{ "chainId": 46630, "generatedAt": "ISO8601", "actions": [
  { "id": 1, "asset": "0x..", "assetSymbol": "TSLA", "actionType": "CASH_DIVIDEND",
    "status": "CLAIMABLE", "ratePerShare": "0.5", "recordBlock": 1234,
    "payableAt": 1781110880, "claimDeadline": 1781715680, "payoutToken": "0x..",
    "merkleRoot": "0x..", "totalPayout": "12.0", "totalClaimed": "5.0",
    "holderCount": 2, "metadataURI": "ipfs://..", "explorerUrl": "https://.." } ] }
```
Amounts in this public feed are human-decimal strings; on-chain values stay wei.
