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
  MAX_BPS,
  type Address,
  type Hex,
  type ProofsFile,
} from "./types.js";
import { buildProofs, verifyLeaf } from "./merkle.js";
import { netFromGross } from "./eligibility.js";

/** A single verification problem, with enough context to act on. */
export interface VerifyIssue {
  readonly kind:
    | "format"
    | "proof"
    | "root"
    | "total"
    | "holder-count"
    | "withholding"
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

  // Action-level withholding (additive v1 extension). Validate range up-front so
  // a bogus rate is reported once rather than per-claim.
  const withholdingBps = file.withholdingBps;
  let withholdingUsable = true;
  if (withholdingBps !== undefined) {
    if (
      !Number.isInteger(withholdingBps) ||
      withholdingBps < 0 ||
      withholdingBps > MAX_BPS
    ) {
      issues.push({
        kind: "withholding",
        message: `withholdingBps=${withholdingBps} is out of range [0, ${MAX_BPS}]`,
      });
      withholdingUsable = false;
    }
  }
  const declaredGross =
    file.totalGross !== undefined
      ? parseBigInt(file.totalGross, "totalGross", issues)
      : null;

  const entries = Object.entries(file.claims);
  if (entries.length !== file.holderCount) {
    issues.push({
      kind: "holder-count",
      message: `holderCount=${file.holderCount} but claims has ${entries.length} entries`,
    });
  }

  // 1) Verify each proof against the stated root (contract-equivalent rule).
  let checked = 0;
  let sum = 0n; // Σ NET (leaf amount)
  let grossSum = 0n; // Σ GROSS (when present)
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

    // Withholding cross-check: when a claim carries grossAmount, the leaf
    // (net) amount must equal gross * (10000 - bps) / 10000. Also confirms the
    // issuer didn't quietly pay more/less than the declared rate implies.
    if (claim.grossAmount !== undefined) {
      let gross: bigint;
      try {
        gross = BigInt(claim.grossAmount);
      } catch {
        issues.push({
          kind: "schema",
          message: `claim ${addr}: grossAmount "${claim.grossAmount}" is not an integer`,
        });
        continue;
      }
      grossSum += gross;
      if (withholdingBps !== undefined && withholdingUsable) {
        const expectedNet = netFromGross(gross, withholdingBps);
        if (expectedNet !== amount) {
          issues.push({
            kind: "withholding",
            message:
              `claim ${addr}: net amount ${amount} != gross ${gross} * ` +
              `(10000-${withholdingBps})/10000 = ${expectedNet}`,
          });
        }
      }
    }

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
          // grossAmount/balance are not part of the leaf — only index/account/
          // amount feed the tree — so any placeholder is fine for re-derivation.
          grossAmount: h.amount,
          index: h.index,
          balance: 0n,
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

  // 3) Σ (NET) amount == totalPayout.
  if (declaredTotal !== null && sum !== declaredTotal) {
    issues.push({
      kind: "total",
      message: `Σ amount=${sum} != totalPayout=${declaredTotal}`,
    });
  }

  // 4) Σ gross == totalGross (when both are present).
  if (declaredGross !== null && grossSum !== declaredGross) {
    issues.push({
      kind: "total",
      message: `Σ grossAmount=${grossSum} != totalGross=${declaredGross}`,
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
