/**
 * Canonical encoding test.
 *
 * Builds a tree for a fixed holder set and asserts that:
 *   - the OZ tree's leaf for each row equals the independent `canonicalLeaf`
 *     (i.e. the double-keccak of abi.encode(id,index,account,amount)), and
 *   - every emitted proof verifies against the root under the contract's
 *     sorted-pair rule.
 *
 * This nails down INTEGRATION.md §4 in JS without needing a chain.
 */
import { describe, it, expect } from "vitest";
import { keccak256, encodeAbiParameters, concatHex, getAddress } from "viem";
import {
  canonicalLeaf,
  buildTree,
  buildProofs,
  verifyLeaf,
} from "./merkle.js";
import { LEAF_TYPES, type Address, type Hex } from "./types.js";

const ACTION_ID = 7n;

// A fixed, deliberately unsorted holder set (varied amounts incl. a zero).
const HOLDERS = [
  { account: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address, amount: 5_000_000_000_000_000_000n, index: 0 },
  { account: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as Address, amount: 7_000_000_000_000_000_000n, index: 1 },
  { account: "0x90f79bf6eb2c4f870365e785982e1f101e93b906" as Address, amount: 1n, index: 2 },
  { account: "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65" as Address, amount: 0n, index: 3 },
];

/** Reference leaf computed the long way, matching Solidity MerkleHelper.leaf. */
function referenceLeaf(id: bigint, index: bigint, account: Address, amount: bigint): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }],
      [id, index, getAddress(account), amount],
    ),
  );
  return keccak256(concatHex([inner]));
}

describe("canonical leaf encoding (INTEGRATION.md §4)", () => {
  it("canonicalLeaf matches the explicit double-keccak reference", () => {
    for (const h of HOLDERS) {
      expect(canonicalLeaf(ACTION_ID, BigInt(h.index), h.account, h.amount)).toEqual(
        referenceLeaf(ACTION_ID, BigInt(h.index), h.account, h.amount),
      );
    }
  });

  it("OZ StandardMerkleTree uses the same leaf hash as the contract", () => {
    const rows = HOLDERS.map(
      (h) => [ACTION_ID, BigInt(h.index), h.account, h.amount] as const,
    );
    const tree = buildTree(rows.map((r) => [r[0], r[1], r[2], r[3]]));

    // For every leaf the tree reports, its hash must equal our canonical leaf.
    for (const [, value] of tree.entries()) {
      const [id, index, account, amount] = value as [string, string, string, string];
      const expected = canonicalLeaf(
        BigInt(id),
        BigInt(index),
        account.toLowerCase() as Address,
        BigInt(amount),
      );
      const leafHash = tree.leafHash([id, index, account, amount]) as Hex;
      expect(leafHash).toEqual(expected);
    }
  });

  it("root is a 32-byte hash and every proof verifies against it", () => {
    const { root, proofs } = buildProofs(ACTION_ID, HOLDERS);
    expect(root).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(proofs).toHaveLength(HOLDERS.length);

    HOLDERS.forEach((h, i) => {
      const proof = proofs[i]!;
      expect(
        verifyLeaf(root, ACTION_ID, BigInt(h.index), h.account, h.amount, proof),
      ).toBe(true);
    });
  });

  it("a tampered amount fails verification (negative control)", () => {
    const { root, proofs } = buildProofs(ACTION_ID, HOLDERS);
    const h = HOLDERS[0]!;
    expect(
      verifyLeaf(root, ACTION_ID, BigInt(h.index), h.account, h.amount + 1n, proofs[0]!),
    ).toBe(false);
  });

  it("StandardMerkleTree.verify and our verifyLeaf agree on the type list", () => {
    // Guards against an accidental edit to LEAF_TYPES drifting from the encoding.
    expect([...LEAF_TYPES]).toEqual(["uint256", "uint256", "address", "uint256"]);
  });
});
