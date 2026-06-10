/**
 * Helpers for the `corporax-merkle-v1` proofs.json artifact (INTEGRATION.md §5).
 *
 * These bridge the on-disk artifact (decimal strings, lowercase address keys)
 * to the typed, wei-as-bigint {@link EligibleClaim} the claim path consumes.
 */
import { getAddress, isAddress } from "viem";
import {
  PROOFS_FORMAT,
  type Address,
  type EligibleClaim,
  type Hex,
  type ProofsFile,
} from "./types.js";

/**
 * Validate that an unknown value is a well-formed `corporax-merkle-v1`
 * ProofsFile. Throws a descriptive error if not; narrows the type on success.
 *
 * Use this when ingesting an artifact you did not produce (e.g. fetched over
 * HTTP) before trusting its claims.
 */
export function parseProofsFile(value: unknown): ProofsFile {
  if (typeof value !== "object" || value === null) {
    throw new Error("proofs.json: not an object");
  }
  const v = value as Record<string, unknown>;
  if (v.format !== PROOFS_FORMAT) {
    throw new Error(
      `proofs.json: unexpected format ${String(v.format)} (want ${PROOFS_FORMAT})`,
    );
  }
  for (const key of [
    "actionId",
    "asset",
    "payoutToken",
    "ratePerShare",
    "merkleRoot",
    "totalPayout",
  ] as const) {
    if (typeof v[key] !== "string") {
      throw new Error(`proofs.json: missing/invalid string field "${key}"`);
    }
  }
  if (typeof v.chainId !== "number" || typeof v.recordBlock !== "number") {
    throw new Error("proofs.json: chainId/recordBlock must be numbers");
  }
  if (typeof v.claims !== "object" || v.claims === null) {
    throw new Error("proofs.json: claims must be an object");
  }
  // Shallow-validate every claim entry.
  for (const [addr, entry] of Object.entries(v.claims as Record<string, unknown>)) {
    if (!isAddress(addr)) {
      throw new Error(`proofs.json: claims key "${addr}" is not an address`);
    }
    const e = entry as Record<string, unknown>;
    if (
      typeof e.index !== "number" ||
      typeof e.amount !== "string" ||
      !Array.isArray(e.proof)
    ) {
      throw new Error(`proofs.json: malformed claim for ${addr}`);
    }
  }
  return value as ProofsFile;
}

/**
 * Resolve the {@link EligibleClaim} for `account` from a parsed ProofsFile.
 * Returns `undefined` if the address is not in the claim set.
 *
 * Address lookup is case-insensitive (claims are keyed by lowercase, but we
 * accept any casing). All decimal strings are converted to wei `bigint`.
 */
export function eligibleClaimFor(
  proofs: ProofsFile,
  account: Address,
): EligibleClaim | undefined {
  const key = account.toLowerCase();
  const entry = proofs.claims[key];
  if (!entry) {
    return undefined;
  }
  return {
    actionId: BigInt(proofs.actionId),
    index: BigInt(entry.index),
    // Normalise to checksum form for the on-chain call.
    account: getAddress(account),
    amount: BigInt(entry.amount),
    proof: entry.proof as readonly Hex[],
  };
}

/** Every eligible claim in a ProofsFile, in `claims` insertion order. */
export function allEligibleClaims(proofs: ProofsFile): EligibleClaim[] {
  const actionId = BigInt(proofs.actionId);
  return Object.entries(proofs.claims).map(([addr, entry]) => ({
    actionId,
    index: BigInt(entry.index),
    account: getAddress(addr as Address),
    amount: BigInt(entry.amount),
    proof: entry.proof as readonly Hex[],
  }));
}
