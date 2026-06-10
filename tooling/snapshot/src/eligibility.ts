/**
 * Eligibility shaping: exclusions (PRD P1-3) and withholding (PRD P1-5).
 *
 * Both transforms run on the BALANCE MAP / amounts BEFORE the Merkle tree is
 * built, so they change which leaves exist and what each leaf commits to —
 * exactly where policy belongs. Everything here is pure BigInt math with no I/O,
 * so it is fully unit-testable and cannot drift from the determinism guarantee.
 */
import { MAX_BPS, type Address, type ExclusionsRecord } from "./types.js";

const BPS_DENOM = BigInt(MAX_BPS); // 10000n

/**
 * Normalise an exclusion list to a de-duplicated, sorted, lowercase set.
 * Sorting keeps the recorded `exclusions.addresses` array deterministic
 * regardless of CLI/file input order.
 */
export function normalizeExclusions(
  addresses: readonly Address[],
): Address[] {
  const set = new Set<Address>();
  for (const a of addresses) set.add(a.toLowerCase() as Address);
  return [...set].sort((x, y) => {
    const xv = BigInt(x);
    const yv = BigInt(y);
    return xv < yv ? -1 : xv > yv ? 1 : 0;
  });
}

/**
 * Drop excluded addresses from a balance map BEFORE indexing/amount/tree, so
 * non-beneficial-owner contracts (AMM pools, bridges, escrows) never accrue a
 * dividend leaf.
 *
 * Returns the filtered map plus an {@link ExclusionsRecord} for the artifact:
 * `addresses` = the full normalised exclusion set that was requested;
 * `applied`   = the subset that was actually present (positive balance) and
 *               therefore materially removed.
 *
 * The input map is not mutated.
 */
export function applyExclusions(
  balances: Map<Address, bigint>,
  exclude: readonly Address[],
): { balances: Map<Address, bigint>; record: ExclusionsRecord } {
  const addresses = normalizeExclusions(exclude);
  const excludeSet = new Set(addresses);

  const filtered = new Map<Address, bigint>();
  const applied: Address[] = [];
  for (const [account, balance] of balances) {
    const key = account.toLowerCase() as Address;
    if (excludeSet.has(key)) {
      // Only count it as "applied" if it was actually an eligible holder
      // (positive balance) — a listed-but-absent address had no effect.
      if (balance > 0n) applied.push(key);
      continue;
    }
    filtered.set(key, balance);
  }

  // `applied` follows the same deterministic address-ascending order.
  applied.sort((x, y) => {
    const xv = BigInt(x);
    const yv = BigInt(y);
    return xv < yv ? -1 : xv > yv ? 1 : 0;
  });

  return { balances: filtered, record: { addresses, applied } };
}

/** Validate a basis-points value (0..10000). Throws on out-of-range. */
export function assertBps(bps: number, label = "withholding-bps"): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_BPS) {
    throw new Error(
      `${label} must be an integer in [0, ${MAX_BPS}] (basis points), got: ${bps}`,
    );
  }
}

/**
 * Net claimable from gross under a withholding rate, in wei (floor division):
 *
 *     net = gross * (10000 - bps) / 10000
 *
 * Pure BigInt — no float. `bps=0` returns `gross` unchanged.
 */
export function netFromGross(gross: bigint, bps: number): bigint {
  assertBps(bps);
  if (bps === 0) return gross;
  return (gross * (BPS_DENOM - BigInt(bps))) / BPS_DENOM;
}
