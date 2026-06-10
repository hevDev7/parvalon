# @corporax/sdk

Typed **TypeScript / viem client** for the CorporaX corporate-actions &
dividend protocol on Robinhood Chain (Arbitrum Orbit L2). Integrators get
read/write helpers, CAE-1 event watchers, the canonical Merkle claim builder,
and a high-level `CorporaXClient` — so you **never hand-roll calldata or decode
event logs** yourself.

Conforms exactly to [`docs/INTEGRATION.md`](../../docs/INTEGRATION.md): the enums,
struct field orders, CAE-1 events (§3), the FROZEN Merkle leaf encoding (§4) and
the `corporax-merkle-v1` proofs schema (§5). ABIs are **imported, never
hand-written** — `scripts/sync-abis.ts` copies them verbatim from the repo-root
`abis/*.json` into `src/generated/abis.ts` and wraps each in `as const` for viem
type inference.

---

## Install & build

```bash
npm install
npm run typecheck   # sync ABIs + strict tsc --noEmit
npm run build       # sync ABIs (prebuild) + tsc -> dist/
npm test            # sync ABIs + vitest run
```

> Use **npm**, not pnpm (pnpm is broken on the dev machine). Node ≥ 20.

`npm run sync-abis` regenerates `src/generated/abis.ts` from the canonical
`abis/*.json`. It runs automatically before `build`, `typecheck`, and `test`,
and after any contract/ABI change you should re-run it to stay in lock-step.

---

## Quick start — the high-level client

```ts
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CorporaXClient, localAnvil } from "@corporax/sdk";
import deployment from "../../deployments/31337.json" assert { type: "json" };

const publicClient = createPublicClient({ chain: localAnvil, transport: http() });
const walletClient = createWalletClient({
  chain: localAnvil,
  account: privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`),
  transport: http(),
});

const cx = new CorporaXClient({
  chain: localAnvil,
  addresses: { registry: deployment.registry, distributor: deployment.distributor },
  publicClient,
  walletClient, // omit for read-only
});

// Reads
const count = await cx.actionCount();                 // bigint, ids run 1..count
const action = await cx.getAction(1n);                // full CorporateAction
const view = await cx.actionView(1n);                 // gas-lean ActionView
const all = await cx.listActions();                   // CorporateAction[]
const funded = await cx.totalFunded(1n);              // bigint (wei)
const claimed = await cx.isClaimed(1n, 0n);           // bool
```

### Chains

`robinhoodTestnet` (46630, primary), `arbitrumSepoliaChain` (421614, fallback),
`localAnvil` (31337, dev) are exported as viem `Chain` objects. Override the RPC
URL with your endpoint (`ROBINHOOD_TESTNET_RPC_URL` etc.). `chainById(id)` and
`CHAINS` look them up by id.

---

## Claiming a dividend from a `proofs.json`

The claim path is `claim(id, index, account, amount, proof[])` — **claim-on-behalf**:
anyone may submit, funds always go to `account`. Given a `corporax-merkle-v1`
artifact, the SDK resolves the holder's entry and submits the claim:

```ts
import { parseProofsFile } from "@corporax/sdk";
import proofsJson from "../../deployments/proofs-31337-1.json" assert { type: "json" };

const proofs = parseProofsFile(proofsJson);           // validates the format

// One call: resolve the holder's entry and submit. Funds go to `holder`.
const hash = await cx.claimForAccount(proofs, holder);

// …or resolve first, then submit (e.g. to inspect the EligibleClaim):
import { eligibleClaimFor } from "@corporax/sdk";
const eligible = eligibleClaimFor(proofs, holder);    // EligibleClaim | undefined
if (eligible) await cx.claimFromEligible(eligible);
```

### Verifying a proof off-chain

```ts
import { verifyProof, canonicalLeaf } from "@corporax/sdk";

// Same rule as the contract: double-hashed leaf + sorted-pair keccak256 fold.
const ok = verifyProof(proofs.merkleRoot, 1n, 0n, holder, amount, proof);
const leaf = canonicalLeaf(1n, 0n, holder, amount); // keccak256(concat(keccak256(abi.encode(...))))
```

---

## Issuer flow — announce, fund, publish, sweep

```ts
import { ActionType } from "@corporax/sdk";

// 1. Announce a cash dividend.
await cx.announceAction({
  asset: deployment.tsla,
  actionType: ActionType.CASH_DIVIDEND,
  ratePerShare: 500000000000000000n,        // 0.5 payout-token per share (1e18)
  recordBlock: 2n,
  payableAt: 1781110880n,
  claimDeadline: 1781715680n,
  payoutToken: deployment.usdg,
  metadataURI: "ipfs://…",
});

// 2. Publish the Merkle root (from the snapshot CLI / proofs.json).
await cx.publishRoot({ id: 1n, root: proofs.merkleRoot, totalPayout: 12_000000000000000000n, holderCount: 2n });

// 3. Fund — approve the payout token, then fund. Two transactions.
await cx.fundWithApproval({ payoutToken: deployment.usdg, id: 1n, amount: 12_000000000000000000n });

// 4. After the deadline, sweep what's left.
await cx.sweepUnclaimed(1n);

// (cancel an action that hasn't gone claimable)
await cx.cancelAction(2n);
```

---

## Watching CAE-1 events

Every watcher returns an `unwatch()` function and pushes **typed, decoded**
payloads (no positional tuples):

```ts
const unwatch = cx.watchClaimed((e) => {
  // e: { id, index, account, amount } — all bigints / addresses
  console.log(`claim ${e.index} → ${e.account}: ${e.amount}`);
});
// later: unwatch();

cx.watchActionAnnounced((e) => { /* ActionAnnouncedEvent */ });
cx.watchMerkleRootPublished((e) => { /* MerkleRootPublishedEvent */ });
cx.watchActionStatusChanged((e) => { /* { id, previousStatus, newStatus } */ });
cx.watchFunded((e) => { /* FundedEvent */ });
cx.watchUnclaimedSwept((e) => { /* UnclaimedSweptEvent */ });
```

Decoding a single raw log (e.g. from a receipt) without a watcher:

```ts
import { decodeClaimed } from "@corporax/sdk";
const event = decodeClaimed({ topics: log.topics, data: log.data });
```

---

## Functional API & calldata encoders

The class is sugar over standalone functions — use them directly if you prefer:

```ts
import { getAction, claim, watchClaimed, claimCalldata } from "@corporax/sdk";

await getAction(publicClient, registry, 1n);
await claim(walletClient, distributor, { id: 1n, index: 0n, account, amount, proof });
const unwatch = watchClaimed(publicClient, distributor, (e) => { /* … */ });

// Pure calldata (no client) — for relayers, gas estimation, multisig batching:
const data = claimCalldata({ id: 1n, index: 0n, account, amount, proof }); // 0x…
```

`encodeAnnounceAction` / `encodeClaim` / `encodeFund` / … return
`{ abi, functionName, args }` request fragments; `*Calldata` helpers return raw
`0x` calldata.

---

## Enums & names

```ts
import {
  ActionType, ActionStatus,
  actionTypeName, actionStatusName,
} from "@corporax/sdk";

ActionType.CASH_DIVIDEND;            // 0
ActionStatus.CLAIMABLE;              // 2
actionStatusName(2);                 // "CLAIMABLE"
actionTypeName(0);                   // "CASH_DIVIDEND"
```

`ActionType`: `CASH_DIVIDEND=0, STOCK_SPLIT=1, STOCK_DIVIDEND=2`.
`ActionStatus`: `ANNOUNCED=0, ROOT_PUBLISHED=1, CLAIMABLE=2, FINALIZED=3, CANCELLED=4`.

---

## Tests

`vitest`, no live chain required:

- `src/merkle.test.ts` — the canonical leaf + `verifyProof` against the FROZEN
  rule, against OZ `StandardMerkleTree`, and against the real
  `deployments/proofs-31337-1.json` (every proof verifies; the root rebuilds; a
  tampered amount is rejected).
- `src/events.test.ts` — every CAE-1 decoder round-trips a synthesised log.
- `src/encode.test.ts` — calldata encoders decode back to the right call;
  read/write helpers and `CorporaXClient` drive mock viem clients.

```bash
npm test
```

---

## Notes / production surface

- **ABIs**: imported verbatim from `abis/*.json`. Do not hand-edit. Re-run
  `npm run sync-abis` after a contract change.
- **`fundWithApproval`** sends **two** transactions and, by default, waits for the
  `approve` receipt via the `publicClient` before `fund` (so `transferFrom` sees
  the allowance). Pass `{ awaitApproval: false }` to fire both without waiting.
- **Amounts are `bigint` wei** throughout the SDK; the human-decimal strings in
  the public `/api/actions` feed (INTEGRATION.md §10) are a frontend concern.
- The default chain RPC URLs are placeholders — point them at your endpoint.
```
