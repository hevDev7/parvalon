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
 * Internal, ADDITIVE schema-minor counter for `corporax-merkle-v1`.
 *
 * The wire `format` string is FROZEN by INTEGRATION.md §5 and never changes —
 * every reader that understood v1 still understands these artifacts because all
 * new fields are *optional additions* (exclusions, withholdingBps, per-claim
 * grossAmount, metadata, proofsCid). This counter is a non-breaking marker that
 * lets tooling/audit logs distinguish "plain v1" (minor 0) from artifacts that
 * carry the exclusion/withholding/IPFS extensions (minor 1). It is purely
 * informational; consumers MUST NOT gate parsing on it.
 */
export const SCHEMA_MINOR = 1 as const;

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
  /**
   * GROSS payout owed before withholding: `balance * ratePerShare / 1e18`
   * (wei of the payout token).
   */
  readonly grossAmount: bigint;
  /**
   * NET claimable payout after withholding: `gross * (10000 - withholdingBps)
   * / 10000` (wei). This is the value committed into the Merkle leaf and the
   * exact amount the contract will transfer on `claim`. With `withholdingBps=0`
   * it equals `grossAmount`.
   */
  readonly amount: bigint;
  /** 0-based deterministic position — also the on-chain bitmap slot. */
  readonly index: number;
}

/** One holder's claim entry in proofs.json (`claims[address]`). */
export interface ClaimEntry {
  readonly index: number;
  /**
   * NET claimable amount — decimal string (wei). This is the leaf `amount`; it
   * is what `claim()` pays and what every proof commits to.
   */
  readonly amount: string;
  /**
   * GROSS amount before withholding — decimal string (wei). Present whenever a
   * withholding rate is applied (and emitted unconditionally for auditability,
   * equal to `amount` when `withholdingBps=0`). NOT part of the leaf.
   */
  readonly grossAmount?: string;
  /** Merkle proof: sorted-pair siblings, `0x`-prefixed. */
  readonly proof: Hex[];
}

/**
 * Standardised `metadataURI` payload schema (the JSON a `metadataURI` resolves
 * to — e.g. `ipfs://<cid>`). This is the MECHANISM-level contract only: it
 * documents the fields tooling reads/writes so issuer feeds, the snapshot tool,
 * and the frontend agree on shape. Anything legal/KYC/jurisdictional in here is
 * asserted BY THE ISSUER — CorporaX neither validates nor enforces it.
 *
 * All fields are optional so partial issuer metadata is still well-formed.
 */
export interface ActionMetadata {
  /**
   * Withholding tax applied to the gross dividend, in basis points (0..10000).
   * The snapshot tool derives the net leaf `amount` from this; recording it here
   * lets a verifier recompute gross↔net without the CLI flags.
   */
  readonly withholdingBps?: number;
  /** Issuer tax jurisdiction (e.g. ISO-3166 alpha-2 `"US"`). Issuer-asserted. */
  readonly jurisdiction?: string;
  /** Ex-dividend date (ISO-8601 `YYYY-MM-DD`). */
  readonly exDate?: string;
  /** Record date (ISO-8601 `YYYY-MM-DD`) — informational mirror of recordBlock. */
  readonly recordDate?: string;
  /** Pay date (ISO-8601 `YYYY-MM-DD`). */
  readonly payDate?: string;
  /**
   * Tax classification of the distribution (issuer-asserted), e.g.
   * `"ordinary"`, `"qualified"`, `"return-of-capital"`. Free-form by design.
   */
  readonly taxClass?: string;
}

/**
 * The applied exclusions block, recorded for auditability. Excluded addresses
 * are dropped from the eligible set BEFORE indexing/amount/tree, so non-
 * beneficial-owner contracts (AMM pools, bridges, escrows) never accrue a leaf.
 */
export interface ExclusionsRecord {
  /** Lowercase addresses that were excluded from the eligible holder set. */
  readonly addresses: Address[];
  /**
   * Of `addresses`, the subset that actually held a positive balance at the
   * record block and was therefore *removed* (vs. listed but never a holder).
   * Lets an auditor see the exclusions that had a material effect.
   */
  readonly applied: Address[];
}

/**
 * The canonical `corporax-merkle-v1` artifact. Mirrors INTEGRATION.md §5
 * field-for-field, plus ADDITIVE optional extensions (exclusions, withholding,
 * metadata, IPFS CID). The wire `format` stays `corporax-merkle-v1`; v1 readers
 * that ignore unknown keys are unaffected. `claims` is keyed by **lowercase**
 * holder address.
 */
export interface ProofsFile {
  readonly format: typeof PROOFS_FORMAT;
  /**
   * Additive schema-minor marker (see {@link SCHEMA_MINOR}). Informational only;
   * never gate parsing on it.
   */
  readonly schemaMinor?: number;
  /** Decimal string. */
  readonly actionId: string;
  readonly chainId: number;
  readonly asset: Address;
  readonly payoutToken: Address;
  /** Decimal string (wei per 1e18 shares). */
  readonly ratePerShare: string;
  readonly recordBlock: number;
  readonly merkleRoot: Hex;
  /** Decimal string (wei) — the exact funding target, Σ (NET) amount. */
  readonly totalPayout: string;
  readonly holderCount: number;
  readonly leafEncoding: readonly string[];
  /**
   * Withholding rate applied action-wide, in basis points (0..10000). Present
   * (and emitted as `0` for clarity) whenever the field is tracked; the net leaf
   * `amount = gross * (10000 - withholdingBps) / 10000`.
   */
  readonly withholdingBps?: number;
  /**
   * Sum of GROSS amounts before withholding — decimal string (wei). Equals
   * `totalPayout` when `withholdingBps=0`. Present when withholding is tracked.
   */
  readonly totalGross?: string;
  /** Applied exclusions, for auditability. Present when any exclusion was given. */
  readonly exclusions?: ExclusionsRecord;
  /**
   * Standardised action metadata (the resolved `metadataURI` payload). Echoed
   * into the artifact for convenience; the on-chain source of truth is the
   * action's `metadataURI`. Present when any metadata field is supplied.
   */
  readonly metadata?: ActionMetadata;
  /**
   * Content identifier (CID) of THIS artifact after IPFS pinning, so consumers
   * can content-address it. Present only when `--pin-ipfs` pinned successfully.
   */
  readonly proofsCid?: string;
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
  /**
   * Addresses to drop from the eligible holder set BEFORE indexing/amount/tree
   * (AMM pools, bridges, escrows, the issuer's own treasury). Compared
   * case-insensitively; recorded in the artifact's `exclusions` block. Optional.
   */
  readonly exclude?: readonly Address[];
  /**
   * Withholding rate in basis points (0..10000). The net leaf `amount = gross *
   * (10000 - withholdingBps) / 10000`. Defaults to 0 (no withholding) when
   * omitted. When present (incl. 0) the artifact records `withholdingBps`,
   * `totalGross`, and per-claim `grossAmount`.
   */
  readonly withholdingBps?: number;
  /**
   * Standardised action metadata echoed into the artifact (see
   * {@link ActionMetadata}). Optional; mechanism-only.
   */
  readonly metadata?: ActionMetadata;
}

/** Hard cap on withholding basis points (100% = 10000 bps). */
export const MAX_BPS = 10000 as const;

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
