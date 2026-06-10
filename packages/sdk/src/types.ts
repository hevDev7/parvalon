/**
 * CorporaX SDK — domain types.
 *
 * Every shape here mirrors docs/INTEGRATION.md (FROZEN). The enums, struct field
 * orders, the `corporax-merkle-v1` proofs schema and the CAE-1 event payloads are
 * part of the cross-package contract. Do not rename or reorder fields casually.
 */

/** A `0x`-prefixed hex address. */
export type Address = `0x${string}`;

/** A `0x`-prefixed hex string (hashes, roots, proofs, calldata). */
export type Hex = `0x${string}`;

// ---------------------------------------------------------------------------
// Enums (INTEGRATION.md §2)
// ---------------------------------------------------------------------------

/**
 * Corporate-action type. Solidity `enum ActionType` (uint8).
 * `CASH_DIVIDEND=0, STOCK_SPLIT=1, STOCK_DIVIDEND=2`.
 */
export enum ActionType {
  CASH_DIVIDEND = 0,
  STOCK_SPLIT = 1,
  STOCK_DIVIDEND = 2,
}

/**
 * Action lifecycle status. Solidity `enum ActionStatus` (uint8).
 * `ANNOUNCED=0, ROOT_PUBLISHED=1, CLAIMABLE=2, FINALIZED=3, CANCELLED=4`.
 */
export enum ActionStatus {
  ANNOUNCED = 0,
  ROOT_PUBLISHED = 1,
  CLAIMABLE = 2,
  FINALIZED = 3,
  CANCELLED = 4,
}

/** Human-readable names indexed by the on-chain uint8 value. */
export const ACTION_TYPE_NAMES = [
  "CASH_DIVIDEND",
  "STOCK_SPLIT",
  "STOCK_DIVIDEND",
] as const;

/** Human-readable names indexed by the on-chain uint8 value. */
export const ACTION_STATUS_NAMES = [
  "ANNOUNCED",
  "ROOT_PUBLISHED",
  "CLAIMABLE",
  "FINALIZED",
  "CANCELLED",
] as const;

export type ActionTypeName = (typeof ACTION_TYPE_NAMES)[number];
export type ActionStatusName = (typeof ACTION_STATUS_NAMES)[number];

/** Map an `ActionType` (or raw uint8) to its canonical name. Throws on unknown. */
export function actionTypeName(type: ActionType | number): ActionTypeName {
  const name = ACTION_TYPE_NAMES[type];
  if (name === undefined) {
    throw new Error(`unknown ActionType: ${type}`);
  }
  return name;
}

/** Map an `ActionStatus` (or raw uint8) to its canonical name. Throws on unknown. */
export function actionStatusName(status: ActionStatus | number): ActionStatusName {
  const name = ACTION_STATUS_NAMES[status];
  if (name === undefined) {
    throw new Error(`unknown ActionStatus: ${status}`);
  }
  return name;
}

// ---------------------------------------------------------------------------
// On-chain structs (INTEGRATION.md §2)
// ---------------------------------------------------------------------------

/**
 * The full `CorporateAction` struct returned by `Registry.getAction(id)`.
 * Field order matches the Solidity struct exactly; numbers stay as `bigint`.
 */
export interface CorporateAction {
  readonly id: bigint;
  readonly asset: Address;
  readonly actionType: ActionType;
  readonly ratePerShare: bigint;
  readonly recordBlock: bigint;
  readonly payableAt: bigint;
  readonly claimDeadline: bigint;
  readonly payoutToken: Address;
  readonly merkleRoot: Hex;
  readonly totalPayout: bigint;
  readonly status: ActionStatus;
  readonly metadataURI: string;
}

/**
 * The gas-lean `ActionView` struct returned by `Registry.actionView(id)`.
 * No `metadataURI`; field order matches the Solidity struct exactly.
 */
export interface ActionView {
  readonly actionType: ActionType;
  readonly status: ActionStatus;
  readonly payableAt: bigint;
  readonly claimDeadline: bigint;
  readonly asset: Address;
  readonly payoutToken: Address;
  readonly merkleRoot: Hex;
  readonly totalPayout: bigint;
}

// ---------------------------------------------------------------------------
// Merkle leaf encoding (INTEGRATION.md §4)
// ---------------------------------------------------------------------------

/**
 * The leaf encoding, annotated, exactly as serialised into proofs.json
 * `leafEncoding`. The OZ `StandardMerkleTree` is built from the bare types
 * `["uint256","uint256","address","uint256"]`.
 */
export const LEAF_ENCODING = [
  "uint256 actionId",
  "uint256 index",
  "address account",
  "uint256 amount",
] as const;

/** The raw Solidity ABI types for `StandardMerkleTree.of`. */
export const LEAF_TYPES = ["uint256", "uint256", "address", "uint256"] as const;

// ---------------------------------------------------------------------------
// proofs.json — `corporax-merkle-v1` (INTEGRATION.md §5)
// ---------------------------------------------------------------------------

/** The format discriminator embedded in every proofs.json. */
export const PROOFS_FORMAT = "corporax-merkle-v1" as const;

/** One holder's claim entry in proofs.json (`claims[lowercaseAddress]`). */
export interface ClaimEntry {
  /** 0-based holder position — also the on-chain bitmap slot. */
  readonly index: number;
  /** Owed payout, decimal string (wei of the payout token). */
  readonly amount: string;
  /** Merkle proof: sorted-pair siblings, `0x`-prefixed. */
  readonly proof: Hex[];
}

/**
 * The canonical `corporax-merkle-v1` artifact. Mirrors INTEGRATION.md §5
 * field-for-field. `claims` is keyed by **lowercase** holder address.
 */
export interface ProofsFile {
  readonly format: typeof PROOFS_FORMAT;
  /** Decimal string. */
  readonly actionId: string;
  readonly chainId: number;
  readonly asset: Address;
  readonly payoutToken: Address;
  /** Decimal string (wei per 1e18 shares). */
  readonly ratePerShare: string;
  readonly recordBlock: number;
  readonly merkleRoot: Hex;
  /** Decimal string (wei) — the exact funding target, Σ amount. */
  readonly totalPayout: string;
  readonly holderCount: number;
  readonly leafEncoding: readonly string[];
  readonly claims: Record<string, ClaimEntry>;
}

/**
 * A single eligible claim, resolved from a `ProofsFile` for one holder.
 * This is the input to {@link claimFromEligible}: it carries everything
 * `Distributor.claim(id, index, account, amount, proof)` needs.
 */
export interface EligibleClaim {
  readonly actionId: bigint;
  readonly index: bigint;
  readonly account: Address;
  readonly amount: bigint;
  readonly proof: readonly Hex[];
}

// ---------------------------------------------------------------------------
// deployments/<chainId>.json (INTEGRATION.md §6)
// ---------------------------------------------------------------------------

/** The address registry written per chain to `deployments/<chainId>.json`. */
export interface Deployment {
  readonly chainId: number;
  readonly registry: Address;
  readonly distributor: Address;
  readonly actionSource: Address;
  readonly usdg: Address;
  readonly tsla: Address;
  readonly amzn: Address;
  readonly admin: Address;
  readonly issuer: Address;
}

/** The minimal address set the SDK actually needs to operate. */
export interface CorporaXAddresses {
  readonly registry: Address;
  readonly distributor: Address;
}

// ---------------------------------------------------------------------------
// Decoded CAE-1 event payloads (INTEGRATION.md §3)
// ---------------------------------------------------------------------------

/** `Registry.ActionAnnounced` decoded args. */
export interface ActionAnnouncedEvent {
  readonly id: bigint;
  readonly asset: Address;
  readonly actionType: ActionType;
  readonly ratePerShare: bigint;
  readonly recordBlock: bigint;
  readonly payableAt: bigint;
  readonly claimDeadline: bigint;
  readonly payoutToken: Address;
  readonly metadataURI: string;
}

/** `Registry.MerkleRootPublished` decoded args. */
export interface MerkleRootPublishedEvent {
  readonly id: bigint;
  readonly root: Hex;
  readonly totalPayout: bigint;
  readonly holderCount: bigint;
}

/** `Registry.ActionStatusChanged` decoded args. */
export interface ActionStatusChangedEvent {
  readonly id: bigint;
  readonly previousStatus: ActionStatus;
  readonly newStatus: ActionStatus;
}

/** `Distributor.Funded` decoded args. */
export interface FundedEvent {
  readonly id: bigint;
  readonly from: Address;
  readonly amount: bigint;
  readonly totalFunded: bigint;
}

/** `Distributor.Claimed` decoded args. */
export interface ClaimedEvent {
  readonly id: bigint;
  readonly index: bigint;
  readonly account: Address;
  readonly amount: bigint;
}

/** `Distributor.UnclaimedSwept` decoded args. */
export interface UnclaimedSweptEvent {
  readonly id: bigint;
  readonly to: Address;
  readonly amount: bigint;
}
