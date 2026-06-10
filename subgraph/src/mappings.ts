// CorporaX subgraph mappings (AssemblyScript).
//
// Materialises the CAE-1 event stream (INTEGRATION.md §3) into the entities
// declared in schema.graphql. Design rules:
//   * Amounts stay as on-chain BigInt (wei) — no float math, ever.
//   * uint8 actionType/status are mapped to their canonical enum *names*
//     (INTEGRATION.md §2) via the lookup helpers below.
//   * CorporateAction.id is the decimal action id (ids run 1..actionCount).
//   * Child records use `txHash-logIndex` ids so replays are idempotent.
//
// Generated types (./types/...) come from `graph codegen` reading subgraph.yaml
// + the ABIs. Import paths follow graph-cli's default output layout.

import { BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts";
import {
  ActionAnnounced,
  MerkleRootPublished,
  ActionStatusChanged,
} from "../generated/CorporateActionRegistry/CorporateActionRegistry";
import {
  Funded,
  Claimed,
  UnclaimedSwept,
} from "../generated/DividendDistributor/DividendDistributor";
import {
  CorporateAction,
  Claim,
  Funding,
  Sweep,
} from "../generated/schema";

// ---------------------------------------------------------------------------
// enum mapping helpers — uint8 -> canonical string name (INTEGRATION.md §2)
// ---------------------------------------------------------------------------

/** ActionType: CASH_DIVIDEND=0, STOCK_SPLIT=1, STOCK_DIVIDEND=2. */
function actionTypeName(raw: i32): string {
  if (raw == 0) return "CASH_DIVIDEND";
  if (raw == 1) return "STOCK_SPLIT";
  if (raw == 2) return "STOCK_DIVIDEND";
  // Unknown enum value: surface it loudly but keep indexing from stalling.
  log.warning("Unknown ActionType uint8 value: {}", [raw.toString()]);
  return "CASH_DIVIDEND";
}

/** ActionStatus: ANNOUNCED=0, ROOT_PUBLISHED=1, CLAIMABLE=2, FINALIZED=3, CANCELLED=4. */
function actionStatusName(raw: i32): string {
  if (raw == 0) return "ANNOUNCED";
  if (raw == 1) return "ROOT_PUBLISHED";
  if (raw == 2) return "CLAIMABLE";
  if (raw == 3) return "FINALIZED";
  if (raw == 4) return "CANCELLED";
  log.warning("Unknown ActionStatus uint8 value: {}", [raw.toString()]);
  return "ANNOUNCED";
}

/** `txHash-logIndex` — globally unique, stable across re-org replays. */
function eventId(event: ethereum.Event): string {
  return event.transaction.hash
    .toHexString()
    .concat("-")
    .concat(event.logIndex.toString());
}

/**
 * Load (or lazily create) the CorporateAction for `id`. Distributor events can
 * theoretically arrive before the Registry handler in pathological reorg/replay
 * ordering, so we tolerate a not-yet-announced action by stubbing it; the later
 * ActionAnnounced handler overwrites the descriptive fields.
 */
function loadOrInitAction(id: string, event: ethereum.Event): CorporateAction {
  let action = CorporateAction.load(id);
  if (action == null) {
    action = new CorporateAction(id);
    action.asset = Bytes.empty();
    action.actionType = "CASH_DIVIDEND";
    action.status = "ANNOUNCED";
    action.ratePerShare = BigInt.zero();
    action.recordBlock = BigInt.zero();
    action.payableAt = BigInt.zero();
    action.claimDeadline = BigInt.zero();
    action.payoutToken = Bytes.empty();
    action.merkleRoot = null;
    action.totalPayout = null;
    action.holderCount = null;
    action.totalFunded = BigInt.zero();
    action.totalClaimed = BigInt.zero();
    action.metadataURI = "";
    action.createdAt = event.block.timestamp;
    action.createdAtBlock = event.block.number;
    action.txHash = event.transaction.hash;
  }
  return action as CorporateAction;
}

// ---------------------------------------------------------------------------
// Registry handlers
// ---------------------------------------------------------------------------

export function handleActionAnnounced(event: ActionAnnounced): void {
  let id = event.params.id.toString();
  let action = loadOrInitAction(id, event);

  action.asset = event.params.asset;
  action.actionType = actionTypeName(event.params.actionType);
  // ActionAnnounced is always the first lifecycle event -> ANNOUNCED.
  action.status = "ANNOUNCED";
  action.ratePerShare = event.params.ratePerShare;
  // graph-ts maps Solidity uint64 -> BigInt already; no conversion needed.
  action.recordBlock = event.params.recordBlock;
  action.payableAt = event.params.payableAt;
  action.claimDeadline = event.params.claimDeadline;
  action.payoutToken = event.params.payoutToken;
  action.metadataURI = event.params.metadataURI;

  // Provenance: stamp creation from the announce log (loadOrInit may have set
  // these to a Distributor block if it raced ahead — overwrite with the truth).
  action.createdAt = event.block.timestamp;
  action.createdAtBlock = event.block.number;
  action.txHash = event.transaction.hash;
  action.updatedAt = event.block.timestamp;

  action.save();
}

export function handleMerkleRootPublished(event: MerkleRootPublished): void {
  let id = event.params.id.toString();
  let action = loadOrInitAction(id, event);

  action.merkleRoot = event.params.root;
  action.totalPayout = event.params.totalPayout;
  action.holderCount = event.params.holderCount;
  action.updatedAt = event.block.timestamp;

  action.save();
}

export function handleActionStatusChanged(event: ActionStatusChanged): void {
  let id = event.params.id.toString();
  let action = loadOrInitAction(id, event);

  action.status = actionStatusName(event.params.newStatus);
  action.updatedAt = event.block.timestamp;

  action.save();
}

// ---------------------------------------------------------------------------
// Distributor handlers
// ---------------------------------------------------------------------------

export function handleFunded(event: Funded): void {
  let id = event.params.id.toString();
  let action = loadOrInitAction(id, event);

  // `totalFunded` in the event is the cumulative running total from the
  // contract — trust it as the source of truth rather than re-summing.
  action.totalFunded = event.params.totalFunded;
  action.updatedAt = event.block.timestamp;
  action.save();

  let funding = new Funding(eventId(event));
  funding.action = id;
  funding.from = event.params.from;
  funding.amount = event.params.amount;
  funding.totalFunded = event.params.totalFunded;
  funding.tx = event.transaction.hash;
  funding.timestamp = event.block.timestamp;
  funding.blockNumber = event.block.number;
  funding.save();
}

export function handleClaimed(event: Claimed): void {
  let id = event.params.id.toString();
  let action = loadOrInitAction(id, event);

  // The contract does not emit a cumulative total on Claimed, so accumulate.
  action.totalClaimed = action.totalClaimed.plus(event.params.amount);
  action.updatedAt = event.block.timestamp;
  action.save();

  let claim = new Claim(eventId(event));
  claim.action = id;
  claim.index = event.params.index;
  claim.account = event.params.account;
  claim.amount = event.params.amount;
  claim.tx = event.transaction.hash;
  claim.timestamp = event.block.timestamp;
  claim.blockNumber = event.block.number;
  claim.save();
}

export function handleUnclaimedSwept(event: UnclaimedSwept): void {
  let id = event.params.id.toString();
  // Touch the action so derived `sweeps` resolves; status flips to FINALIZED
  // via the Registry's ActionStatusChanged, not here.
  let action = loadOrInitAction(id, event);
  action.updatedAt = event.block.timestamp;
  action.save();

  let sweep = new Sweep(eventId(event));
  sweep.action = id;
  sweep.to = event.params.to;
  sweep.amount = event.params.amount;
  sweep.tx = event.transaction.hash;
  sweep.timestamp = event.block.timestamp;
  sweep.blockNumber = event.block.number;
  sweep.save();
}
