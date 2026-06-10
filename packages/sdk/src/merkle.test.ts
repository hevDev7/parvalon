/**
 * Merkle leaf + claim encoding tests.
 *
 * Proves the SDK's canonical leaf and proof verification match:
 *  1. the FROZEN rule from INTEGRATION.md §4 (computed independently here), and
 *  2. OpenZeppelin's `StandardMerkleTree` (the CLI / Seed.s.sol producer), and
 *  3. the real artifact deployments/proofs-31337-1.json (byte-for-byte).
 */
import { describe, it, expect } from "vitest";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import {
  encodeAbiParameters,
  keccak256,
  concatHex,
  getAddress,
} from "viem";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalLeaf, verifyProof } from "./merkle.js";
import { eligibleClaimFor, parseProofsFile } from "./proofs.js";
import { LEAF_TYPES, type Address, type Hex } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const PROOFS_PATH = resolve(
  here,
  "../../../deployments/proofs-31337-1.json",
);

/** Independent re-implementation of the FROZEN leaf rule — the oracle. */
function leafByHand(
  actionId: bigint,
  index: bigint,
  account: Address,
  amount: bigint,
): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }],
      [actionId, index, getAddress(account), amount],
    ),
  );
  return keccak256(concatHex([inner]));
}

describe("canonicalLeaf", () => {
  it("matches the by-hand FROZEN double-hash rule", () => {
    const account = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
    expect(canonicalLeaf(1n, 0n, account, 7_000000000000000000n)).toBe(
      leafByHand(1n, 0n, account, 7_000000000000000000n),
    );
  });

  it("is address-case insensitive (checksum-normalised)", () => {
    const lower = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as Address;
    const checksum = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
    expect(canonicalLeaf(1n, 0n, lower, 7n)).toBe(
      canonicalLeaf(1n, 0n, checksum, 7n),
    );
  });

  it("equals the leaf OZ StandardMerkleTree computes for the same row", () => {
    const account = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
    const row: [string, string, string, string] = [
      "1",
      "1",
      getAddress(account),
      "5000000000000000000",
    ];
    const tree = StandardMerkleTree.of([row], [...LEAF_TYPES]);
    // OZ exposes leafHash(value) — the canonical double-hashed leaf.
    expect(canonicalLeaf(1n, 1n, account, 5_000000000000000000n)).toBe(
      tree.leafHash(row),
    );
  });
});

describe("verifyProof against the real proofs-31337-1.json", () => {
  const proofs = parseProofsFile(
    JSON.parse(readFileSync(PROOFS_PATH, "utf8")),
  );

  it("verifies every holder's proof against the published root", () => {
    for (const [addr, entry] of Object.entries(proofs.claims)) {
      const ok = verifyProof(
        proofs.merkleRoot,
        BigInt(proofs.actionId),
        BigInt(entry.index),
        addr as Address,
        BigInt(entry.amount),
        entry.proof,
      );
      expect(ok, `proof for ${addr}`).toBe(true);
    }
  });

  it("agrees with OZ StandardMerkleTree.verify for each holder", () => {
    for (const [addr, entry] of Object.entries(proofs.claims)) {
      const ozOk = StandardMerkleTree.verify(
        proofs.merkleRoot,
        [...LEAF_TYPES],
        [proofs.actionId, entry.index.toString(), getAddress(addr as Address), entry.amount],
        entry.proof,
      );
      expect(ozOk, `OZ proof for ${addr}`).toBe(true);
    }
  });

  it("rejects a tampered amount", () => {
    const [addr, entry] = Object.entries(proofs.claims)[0]!;
    const ok = verifyProof(
      proofs.merkleRoot,
      BigInt(proofs.actionId),
      BigInt(entry.index),
      addr as Address,
      BigInt(entry.amount) + 1n, // tampered
      entry.proof,
    );
    expect(ok).toBe(false);
  });

  it("rebuilds the published root from the leaf set via OZ", () => {
    const rows = Object.entries(proofs.claims).map(([addr, entry]) => [
      proofs.actionId,
      entry.index.toString(),
      getAddress(addr as Address),
      entry.amount,
    ]);
    const tree = StandardMerkleTree.of(rows, [...LEAF_TYPES]);
    expect(tree.root).toBe(proofs.merkleRoot);
  });
});

describe("eligibleClaimFor", () => {
  const proofs = parseProofsFile(
    JSON.parse(readFileSync(PROOFS_PATH, "utf8")),
  );

  it("resolves a holder to a typed EligibleClaim (wei bigints)", () => {
    const claim = eligibleClaimFor(
      proofs,
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address,
    );
    expect(claim).toBeDefined();
    expect(claim!.actionId).toBe(1n);
    expect(claim!.index).toBe(0n);
    expect(claim!.amount).toBe(7_000000000000000000n);
    // Checksum-normalised for the on-chain call.
    expect(claim!.account).toBe("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
    expect(claim!.proof.length).toBe(1);
  });

  it("returns undefined for a non-holder", () => {
    expect(
      eligibleClaimFor(proofs, "0x0000000000000000000000000000000000000001" as Address),
    ).toBeUndefined();
  });
});
