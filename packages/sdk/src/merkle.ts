/**
 * Canonical Parvalon Merkle leaf encoding & proof verification (client-side).
 *
 * FROZEN by INTEGRATION.md §4:
 *
 *     leaf = keccak256( bytes.concat( keccak256( abi.encode(actionId, index, account, amount) ) ) )
 *
 * which is exactly OpenZeppelin's `StandardMerkleTree` double-hash with ABI
 * types `["uint256","uint256","address","uint256"]`. On-chain verification uses
 * `MerkleProof.verify` (sorted-pair / commutative keccak256), and OZ proofs
 * verify against it by design. This module is the single place in the SDK that
 * knows the encoding; the claim builders go through {@link canonicalLeaf}.
 *
 * `@openzeppelin/merkle-tree` is a *devDependency* — it is only needed for
 * {@link verifyProof} (a convenience/test helper). The runtime claim path uses
 * only viem primitives, so consumers are not forced to pull OZ in.
 */
import { encodeAbiParameters, keccak256, concatHex, getAddress } from "viem";
import type { Address, Hex } from "./types.js";

/** The ABI parameter spec for the inner `abi.encode` of a leaf. */
const LEAF_ABI_PARAMS = [
  { type: "uint256" },
  { type: "uint256" },
  { type: "address" },
  { type: "uint256" },
] as const;

/**
 * Compute the canonical double-hashed leaf, mirroring the Solidity rule
 * byte-for-byte:
 *
 *   keccak256(bytes.concat(keccak256(abi.encode(id, index, account, amount))))
 *
 * The address is checksum-normalised first so leaves are case-stable.
 */
export function canonicalLeaf(
  actionId: bigint,
  index: bigint,
  account: Address,
  amount: bigint,
): Hex {
  const inner = keccak256(
    encodeAbiParameters(LEAF_ABI_PARAMS, [
      actionId,
      index,
      getAddress(account),
      amount,
    ]),
  );
  // `bytes.concat` of a single 32-byte value is that value; double-hash it.
  return keccak256(concatHex([inner]));
}

/**
 * Verify a single Merkle proof against a root using the SAME rule the contract
 * uses — sorted-pair (commutative) keccak256 folding over the canonical
 * double-hashed leaf. Pure viem, no OZ dependency at runtime.
 *
 * Returns `true` iff folding `leaf` up through `proof` reproduces `root`.
 */
export function verifyProof(
  root: Hex,
  actionId: bigint,
  index: bigint,
  account: Address,
  amount: bigint,
  proof: readonly Hex[],
): boolean {
  let computed = canonicalLeaf(actionId, index, account, amount);
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed.toLowerCase() === root.toLowerCase();
}

/**
 * Sorted-pair keccak256 of two 32-byte nodes — the commutative hash OZ's
 * `MerkleProof` uses, so order of (a, b) does not matter.
 */
function hashPair(a: Hex, b: Hex): Hex {
  const [lo, hi] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concatHex([lo, hi]));
}
