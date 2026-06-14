/**
 * Canonical Parvalon Merkle construction & verification.
 *
 * The leaf encoding and tree are FROZEN by INTEGRATION.md §4:
 *
 *     leaf = keccak256( bytes.concat( keccak256( abi.encode(actionId, index, account, amount) ) ) )
 *
 * which is exactly OpenZeppelin's `StandardMerkleTree` double-hash with ABI
 * types `["uint256","uint256","address","uint256"]`. On-chain verification uses
 * `MerkleProof.verify` (commutative / sorted-pair keccak256), and OZ
 * `@openzeppelin/merkle-tree` proofs verify against it by design. This module is
 * the single place that knows the encoding; everything else goes through it.
 */
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import {
  encodeAbiParameters,
  keccak256,
  concatHex,
  getAddress,
} from "viem";
import {
  LEAF_TYPES,
  type Address,
  type Hex,
  type Holder,
} from "./types.js";

/** A single tree row, in the exact order INTEGRATION.md §4 mandates. */
export type LeafRow = readonly [
  actionId: bigint,
  index: bigint,
  account: Address,
  amount: bigint,
];

/**
 * Compute the canonical double-hashed leaf independently of OZ — used by tests
 * to prove the OZ tree's leaves match the on-chain `MerkleHelper.leaf` rule
 * byte-for-byte, and usable as a standalone primitive.
 *
 * Mirrors Solidity:
 *   keccak256(bytes.concat(keccak256(abi.encode(id, index, account, amount))))
 */
export function canonicalLeaf(
  actionId: bigint,
  index: bigint,
  account: Address,
  amount: bigint,
): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
      ],
      [actionId, index, getAddress(account), amount],
    ),
  );
  // bytes.concat of a single 32-byte value is just that value; double-hash it.
  return keccak256(concatHex([inner]));
}

/**
 * Build the OZ `StandardMerkleTree` over the given rows.
 *
 * Determinism note: OZ sorts leaves internally by leaf hash when assigning tree
 * positions, so the resulting `root` is a pure function of the *set* of rows —
 * independent of input order. We nonetheless feed rows in a deterministic
 * (index-ascending) order so the per-holder `proof` arrays and `treeIndex`
 * lookups are stable across runs.
 */
export function buildTree(
  rows: readonly LeafRow[],
): StandardMerkleTree<[string, string, string, string]> {
  const encoded = rows.map(
    ([actionId, index, account, amount]) =>
      [
        actionId.toString(),
        index.toString(),
        getAddress(account),
        amount.toString(),
      ] as [string, string, string, string],
  );
  return StandardMerkleTree.of(encoded, [...LEAF_TYPES]);
}

/**
 * Build the tree and extract each holder's proof, keyed by lowercase address.
 * Returns the root and a `proof[]` per holder in the same order as `holders`.
 */
export function buildProofs(
  actionId: bigint,
  holders: readonly Holder[],
): { root: Hex; proofs: Hex[][] } {
  const rows: LeafRow[] = holders.map((h) => [
    actionId,
    BigInt(h.index),
    h.account,
    h.amount,
  ]);
  const tree = buildTree(rows);

  // Map each row back to its proof. OZ exposes proofs by *tree* entry index; we
  // walk the tree's own `entries()` so we read the proof for the exact value we
  // inserted, regardless of OZ's internal reordering.
  const proofByKey = new Map<string, Hex[]>();
  for (const [treeIndex, value] of tree.entries()) {
    const key = rowKey(value as [string, string, string, string]);
    proofByKey.set(key, tree.getProof(treeIndex) as Hex[]);
  }

  const proofs: Hex[][] = rows.map((row) => {
    const key = rowKey([
      row[0].toString(),
      row[1].toString(),
      getAddress(row[2]),
      row[3].toString(),
    ]);
    const proof = proofByKey.get(key);
    if (!proof) {
      throw new Error(
        `internal: no proof produced for holder ${row[2]} (index ${row[1]})`,
      );
    }
    return proof;
  });

  return { root: tree.root as Hex, proofs };
}

/** Stable key for a row, used to join OZ tree entries back to our holders. */
function rowKey(value: [string, string, string, string]): string {
  // Checksummed address from OZ; normalise to lowercase for a stable join key.
  return `${value[0]}|${value[1]}|${value[2].toLowerCase()}|${value[3]}`;
}

/**
 * Verify a single proof against a root using the SAME rule the contract uses:
 * OZ `StandardMerkleTree.verify` performs sorted-pair (commutative) keccak256
 * folding over the canonical double-hashed leaf — identical to
 * `MerkleProof.verify` on-chain. This is the function tests use to prove
 * JS↔Solidity parity.
 */
export function verifyLeaf(
  root: Hex,
  actionId: bigint,
  index: bigint,
  account: Address,
  amount: bigint,
  proof: readonly Hex[],
): boolean {
  return StandardMerkleTree.verify(
    root,
    [...LEAF_TYPES],
    [actionId.toString(), index.toString(), getAddress(account), amount.toString()],
    [...proof],
  );
}
