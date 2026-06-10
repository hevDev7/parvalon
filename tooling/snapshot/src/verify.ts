/**
 * Independent verification of a `corporax-merkle-v1` proofs.json.
 *
 * This is the auditor's tool and the CI gate: given only the artifact, it
 *   1. checks the format/shape,
 *   2. re-verifies EVERY proof against the stated `merkleRoot` using the SAME
 *      sorted-pair rule the contract uses (OZ `StandardMerkleTree.verify`),
 *   3. re-derives the root from the leaf set and asserts it equals `merkleRoot`,
 *   4. asserts `Σ amount == totalPayout` and `holderCount == |claims|`.
 *
 * It depends on nothing but the file itself — no RPC — which is the whole point:
 * "anyone can re-run and verify this root".
 */
import {
  PROOFS_FORMAT,
  type Address,
  type Hex,
  type ProofsFile,
} from "./types.js";
import { buildProofs, verifyLeaf } from "./merkle.js";

/** A single verification problem, with enough context to act on. */
export interface VerifyIssue {
  readonly kind:
    | "format"
    | "proof"
    | "root"
    | "total"
    | "holder-count"
    | "schema";
  readonly message: string;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly issues: VerifyIssue[];
  /** Number of individual claim proofs checked. */
  readonly checked: number;
  /** The root we independently recomputed from the leaf set. */
  readonly recomputedRoot: Hex | null;
}

/**
 * Verify a parsed artifact. Pure — returns a structured result rather than
 * throwing, so callers (CLI, tests) can decide how loud to be.
 */
export function verifyProofs(file: ProofsFile): VerifyResult {
  const issues: VerifyIssue[] = [];

  if (file.format !== PROOFS_FORMAT) {
    issues.push({
      kind: "format",
      message: `unexpected format "${file.format}" (want "${PROOFS_FORMAT}")`,
    });
    // Format mismatch is fatal to the rest of the checks.
    return { ok: false, issues, checked: 0, recomputedRoot: null };
  }

  const actionId = parseBigInt(file.actionId, "actionId", issues);
  const declaredTotal = parseBigInt(file.totalPayout, "totalPayout", issues);
  const root = file.merkleRoot as Hex;

  const entries = Object.entries(file.claims);
  if (entries.length !== file.holderCount) {
    issues.push({
      kind: "holder-count",
      message: `holderCount=${file.holderCount} but claims has ${entries.length} entries`,
    });
  }

  // 1) Verify each proof against the stated root (contract-equivalent rule).
  let checked = 0;
  let sum = 0n;
  const holdersForRoot: Array<{ account: Address; amount: bigint; index: number }> = [];

  for (const [addr, claim] of entries) {
    const account = addr as Address;
    let amount: bigint;
    try {
      amount = BigInt(claim.amount);
    } catch {
      issues.push({
        kind: "schema",
        message: `claim ${addr}: amount "${claim.amount}" is not an integer`,
      });
      continue;
    }
    sum += amount;
    holdersForRoot.push({ account, amount, index: claim.index });

    if (actionId !== null) {
      const valid = verifyLeaf(
        root,
        actionId,
        BigInt(claim.index),
        account,
        amount,
        claim.proof as Hex[],
      );
      if (!valid) {
        issues.push({
          kind: "proof",
          message: `proof FAILED for ${addr} (index ${claim.index}, amount ${claim.amount})`,
        });
      }
    }
    checked += 1;
  }

  // 2) Re-derive the root from the leaf set and compare.
  let recomputedRoot: Hex | null = null;
  if (actionId !== null && holdersForRoot.length > 0) {
    try {
      const { root: derived } = buildProofs(
        actionId,
        holdersForRoot.map((h) => ({
          account: h.account,
          amount: h.amount,
          index: h.index,
          balance: 0n, // not needed for root derivation
        })),
      );
      recomputedRoot = derived;
      if (derived.toLowerCase() !== root.toLowerCase()) {
        issues.push({
          kind: "root",
          message: `recomputed root ${derived} != stated merkleRoot ${root}`,
        });
      }
    } catch (err) {
      issues.push({
        kind: "root",
        message: `failed to recompute root: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 3) Σ amount == totalPayout.
  if (declaredTotal !== null && sum !== declaredTotal) {
    issues.push({
      kind: "total",
      message: `Σ amount=${sum} != totalPayout=${declaredTotal}`,
    });
  }

  return { ok: issues.length === 0, issues, checked, recomputedRoot };
}

function parseBigInt(
  value: string,
  field: string,
  issues: VerifyIssue[],
): bigint | null {
  try {
    return BigInt(value);
  } catch {
    issues.push({ kind: "schema", message: `${field} "${value}" is not an integer` });
    return null;
  }
}
