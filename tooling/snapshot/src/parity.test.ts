/**
 * JS↔Solidity parity test.
 *
 * Loads the REAL artifact produced by the on-chain `Seed.s.sol`
 * (deployments/proofs-31337-1.json) and verifies each listed proof against its
 * stated `merkleRoot` using the SAME sorted-pair rule the contract uses
 * (OZ `StandardMerkleTree.verify`). If these pass, a proof generated/served by
 * the JS side is guaranteed to clear `DividendDistributor.claim` on-chain.
 *
 * It also runs the full `verifyProofs` gate (root re-derivation + Σ amount ==
 * totalPayout) against the same file — exactly what the `verify` CLI command
 * does — so the artifact and our verifier agree end to end.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyLeaf } from "./merkle.js";
import { verifyProofs } from "./verify.js";
import type { Address, Hex, ProofsFile } from "./types.js";

// The committed local deployment artifact — ground truth for parity.
const HERE = dirname(fileURLToPath(import.meta.url));
const PROOFS_PATH = resolve(HERE, "../../../deployments/proofs-31337-1.json");

function loadProofs(): ProofsFile {
  return JSON.parse(readFileSync(PROOFS_PATH, "utf8")) as ProofsFile;
}

describe("parity with the on-chain Seed.s.sol artifact", () => {
  it("loads the corporax-merkle-v1 artifact", () => {
    const file = loadProofs();
    expect(file.format).toBe("corporax-merkle-v1");
    expect(Object.keys(file.claims).length).toBe(file.holderCount);
  });

  it("every committed proof verifies against the stated root (contract rule)", () => {
    const file = loadProofs();
    const actionId = BigInt(file.actionId);
    const root = file.merkleRoot as Hex;

    for (const [addr, claim] of Object.entries(file.claims)) {
      const ok = verifyLeaf(
        root,
        actionId,
        BigInt(claim.index),
        addr as Address,
        BigInt(claim.amount),
        claim.proof as Hex[],
      );
      expect(ok, `proof for ${addr} must verify`).toBe(true);
    }
  });

  it("full verifyProofs gate passes (root re-derivation + Σ amount == totalPayout)", () => {
    const file = loadProofs();
    const result = verifyProofs(file);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    // We independently recomputed the root and it matched the committed one.
    expect(result.recomputedRoot?.toLowerCase()).toBe(file.merkleRoot.toLowerCase());
  });

  it("detects tampering: bumping one amount breaks the gate", () => {
    const file = loadProofs();
    const [firstAddr, firstClaim] = Object.entries(file.claims)[0]!;
    const tampered: ProofsFile = {
      ...file,
      claims: {
        ...file.claims,
        [firstAddr]: {
          ...firstClaim,
          amount: (BigInt(firstClaim.amount) + 1n).toString(),
        },
      },
    };
    const result = verifyProofs(tampered);
    expect(result.ok).toBe(false);
    // Both the per-proof check and the total check should fire.
    expect(result.issues.some((i) => i.kind === "proof")).toBe(true);
    expect(result.issues.some((i) => i.kind === "total")).toBe(true);
  });
});
