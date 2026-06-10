/**
 * Shared types for the CorporaX snapshot CLI.
 *
 * The on-the-wire JSON shapes here are FROZEN by docs/INTEGRATION.md §4–§5
 * ("corporax-merkle-v1"). Field names, ordering of the leaf encoding, and the
 * `0x`-prefixed lowercase address keys are part of the cross-package contract —
 * the Solidity `Seed.s.sol`, this CLI, and the frontend all read/write this
 * exact shape. Do not rename or reorder fields casually.
 */

/** A lowercase `0x`-prefixed hex address. We normalise to lowercase everywhere. */
export type Address = `0x${string}`;

/** A `0x`-prefixed 32-byte hash (root, leaf, or proof element). */
export type Hex = `0x${string}`;

/** The format discriminator embedded in every proofs.json. */
export const PROOFS_FORMAT = "corporax-merkle-v1" as const;

/**
 * The leaf encoding, spelled out exactly as it appears in the artifact and in
 * INTEGRATION.md §4/§5. The OZ `StandardMerkleTree` is built with the bare
 * Solidity types `["uint256","uint256","address","uint256"]`; this annotated
 * variant is what we serialise into `leafEncoding` for human/audit clarity.
 */
export const LEAF_ENCODING = [
  "uint256 actionId",
  "uint256 index",
  "address account",
  "uint256 amount",
] as const;

/** The raw Solidity ABI types passed to `StandardMerkleTree.of`. */
export const LEAF_TYPES = ["uint256", "uint256", "address", "uint256"] as const;

/**
 * A single eligible holder, post-balance-fold. Amounts and balances are wei
 * (BigInt) to avoid any float drift; they are serialised as decimal strings.
 */
export interface Holder {
  /** Lowercase holder address. */
  readonly account: Address;
  /** Token balance at the record block, in token base units (wei). */
  readonly balance: bigint;
  /** Payout owed: `balance * ratePerShare / 1e18` (wei of the payout token). */
  readonly amount: bigint;
  /** 0-based deterministic position — also the on-chain bitmap slot. */
  readonly index: number;
}

/** One holder's claim entry in proofs.json (`claims[address]`). */
export interface ClaimEntry {
  readonly index: number;
  /** Decimal string (wei). */
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

/** Inputs to a snapshot run (already parsed/validated from CLI flags). */
export interface SnapshotInput {
  readonly rpcUrl: string;
  readonly asset: Address;
  /** Token deploy block — the lower bound of the Transfer log scan. */
  readonly deployBlock: bigint;
  /** Record block — the snapshot height (inclusive upper bound). */
  readonly recordBlock: bigint;
  /** Payout rate, wei per 1e18 shares. */
  readonly ratePerShare: bigint;
  /** Corporate action id this snapshot is for. */
  readonly actionId: bigint;
  /** eth_getLogs page size (blocks per request). */
  readonly chunkSize: bigint;
  /**
   * Optional overrides written verbatim into the artifact when known. The chain
   * id is read from the RPC if not supplied; payoutToken defaults to the asset
   * placeholder is never used — it must be supplied for a real artifact, but the
   * snapshot math itself does not depend on it.
   */
  readonly chainId?: number;
  readonly payoutToken?: Address;
}

/**
 * A balance source — the seam that lets tests inject a deterministic holder set
 * without a live RPC. The production implementation folds `eth_getLogs` Transfer
 * events; tests supply a fixture map directly.
 */
export interface BalanceProvider {
  /**
   * Return the full balance map at the record block, keyed by lowercase address,
   * already excluding the zero address. Balances may be zero or negative-free;
   * the snapshot layer filters `> 0`.
   */
  balancesAt(input: SnapshotInput): Promise<Map<Address, bigint>>;
}
