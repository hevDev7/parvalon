# Parvalon — Chainlink Functions attestation source (P0-4)

The off-chain script the Chainlink Functions DON runs to verify that a corporate
action is **authentic** against a licensed market-data vendor, before Parvalon will
record it on-chain. This is the production realization of the D3 oracle seam
(`IActionSource` → `FunctionsActionSource`).

## How it fits together

```
issuer tooling ──requestAttestation(asset, actionType, rate, recordBlock, …)──▶ FunctionsActionSource
                                                                                  │  computes dataHash on-chain
                                                                                  │  sends Functions request (args = the fields)
                                                                                  ▼
                                                       Chainlink Functions DON runs corporate-action-source.js
                                                                                  │  fetches vendor, compares
                                                                                  ▼
        FunctionsActionSource.handleOracleFulfillment(requestId, abi.encode(bool)) ◀── DON returns 1/0
                                                                                  │  _attested[key(asset, dataHash)] = verdict
                                                                                  ▼
   CorporateActionRegistry.announceAction(...) ──validateAnnouncement──▶ reverts unless attested authentic
```

### Why the DON only returns a boolean
`dataHash` is computed **on-chain** by `FunctionsActionSource.requestAttestation`
from the exact fields it sends to the DON, and the attestation is keyed by that
hash. A requester therefore cannot get the DON to vouch for fields it never
verified. That means the source needs **no keccak/abi-encoding** (unavailable in
the restricted Functions runtime) — it only answers "does this match the vendor?".

## Files
| File | What |
|---|---|
| `corporate-action-source.js` | The DON source. Reads `args` + `secrets`, calls the vendor, returns `Functions.encodeUint256(1|0)`. |
| `request-config.js` | Chainlink Functions toolkit request config (source, secrets locations, example args, return type). |
| `simulate.mjs` | Loads the real source and runs it against a mocked Functions runtime + vendor (9 assertions). `npm test`. |

## Request args (set by the contract per action)
```
args[0] asset            args[5] claimDeadline (unix s)
args[1] actionType (0/1/2)args[6] payoutToken
args[2] ratePerShareWei  args[7] ticker      (e.g. "TSLA")
args[3] recordBlock      args[8] exDate      (YYYY-MM-DD)
args[4] payableAt (unix s)args[9] splitRatio (e.g. "4:1", for split/stock-dividend)
```

## Secrets (DON-hosted)
| Key | What |
|---|---|
| `vendorUrl` | base URL of the corporate-actions data vendor |
| `vendorApiKey` | bearer token for the vendor |

The source `GET {vendorUrl}/corporate-actions?ticker=…` and matches a record by type,
per-share amount (±$0.005), and ex-date (and ratio for splits).

## Local test
```bash
cd functions && npm test     # runs simulate.mjs — 9/9 scenarios
```

## Production deployment
1. Create + fund a Chainlink Functions **subscription**; note `subscriptionId`, `donId`, the router address, and pick a `callbackGasLimit` (~300k).
2. Upload `vendorUrl` + `vendorApiKey` as **DON-hosted secrets** with the Functions toolkit.
3. Deploy `FunctionsActionSource` with those params (see `contracts/script/DeployFunctionsSource.s.sol`), then `setRequestData(<CBOR built from request-config.js>)`.
4. Add the source contract as a **consumer** of the subscription.
5. Swap the registry oracle: `registry.setActionSource(functionsActionSource)` (via the timelock — see `docs/DEPLOY.md`), and set `AdminActionSource.autoAttest=false` is irrelevant once swapped.
6. From then on, every `announceAction` requires a DON attestation of the exact action.

See `docs/RUNBOOK.md` (operations) and `docs/DEPLOY.md` (the full handover sequence).
