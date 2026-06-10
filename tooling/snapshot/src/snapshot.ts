/**
 * Snapshot orchestration: balance map → eligible holders → Merkle proofs →
 * canonical `corporax-merkle-v1` artifact.
 *
 * This layer is intentionally free of any I/O (no RPC, no fs). It takes a
 * `BalanceProvider` and pure inputs and returns the in-memory `ProofsFile`. The
 * CLI wires it to the real RPC provider; tests wire it to a fixture provider.
 * Keeping it pure is what makes the determinism guarantee testable offline.
 */
import { getAddress } from "viem";
import {
  PROOFS_FORMAT,
  SCHEMA_MINOR,
  LEAF_ENCODING,
  type Address,
  type ActionMetadata,
  type BalanceProvider,
  type ClaimEntry,
  type ExclusionsRecord,
  type Holder,
  type ProofsFile,
  type SnapshotInput,
} from "./types.js";
import { buildProofs } from "./merkle.js";
import { applyExclusions, assertBps, netFromGross } from "./eligibility.js";

const ONE_E18 = 10n ** 18n;

/**
 * Turn a raw balance map into the deterministic, sorted list of eligible
 * holders with their payout amounts and bitmap indices.
 *
 * Determinism is the core selling point, so every step is order-stable:
 *   1. drop the zero address and any non-positive balance,
 *   2. sort by address ascending (byte order on the 20-byte value),
 *   3. assign 0-based `index` in that sorted order,
 *   4. `grossAmount = balance * ratePerShare / 1e18` (floor division, BigInt),
 *   5. `amount = grossAmount * (10000 - withholdingBps) / 10000` (the NET leaf).
 *
 * Two runs over the same chain state therefore yield identical indices, amounts,
 * and — because the leaf set is identical — an identical Merkle root.
 *
 * `withholdingBps` defaults to 0 (net == gross), preserving prior behaviour.
 * Exclusions are NOT applied here — callers strip excluded addresses from the
 * balance map first (see {@link generateSnapshot}) so `index` numbering already
 * reflects the eligible set.
 */
export function deriveHolders(
  balances: Map<Address, bigint>,
  ratePerShare: bigint,
  withholdingBps = 0,
): Holder[] {
  assertBps(withholdingBps);
  const eligible: Array<{ account: Address; balance: bigint }> = [];
  for (const [account, balance] of balances) {
    if (balance > 0n) {
      eligible.push({ account: account.toLowerCase() as Address, balance });
    }
  }

  // Deterministic order: address ascending. Compare as BigInt of the hex so the
  // ordering is the natural numeric order of the 20-byte address.
  eligible.sort((a, b) => {
    const av = BigInt(a.account);
    const bv = BigInt(b.account);
    return av < bv ? -1 : av > bv ? 1 : 0;
  });

  return eligible.map(({ account, balance }, index) => {
    const grossAmount = (balance * ratePerShare) / ONE_E18;
    return {
      account,
      balance,
      index,
      grossAmount,
      amount: netFromGross(grossAmount, withholdingBps),
    };
  });
}

/** Sum of all holder NET payout amounts — the exact funding target (Σ net). */
export function sumPayout(holders: readonly Holder[]): bigint {
  return holders.reduce((acc, h) => acc + h.amount, 0n);
}

/** Sum of all holder GROSS amounts (before withholding). */
export function sumGross(holders: readonly Holder[]): bigint {
  return holders.reduce((acc, h) => acc + h.grossAmount, 0n);
}

/**
 * Build the full `corporax-merkle-v1` artifact from a balance provider.
 *
 * Note: holders with a positive *balance* but a zero *payout* (e.g. a dust
 * balance that floors to 0 under the rate) are still included as eligible
 * leaves with `amount: 0`. This keeps indices stable and matches the contract,
 * which will simply transfer 0 on claim. The behaviour is documented in the
 * README; a future flag could drop zero-amount leaves if desired.
 */
export async function generateSnapshot(
  input: SnapshotInput,
  provider: BalanceProvider,
): Promise<ProofsFile> {
  const rawBalances = await provider.balancesAt(input);

  // PRD P1-3 — exclusions: drop AMM pools / bridges / escrows from the eligible
  // set BEFORE indexing/amount/tree so they never accrue a dividend leaf.
  let balances = rawBalances;
  let exclusionsRecord: ExclusionsRecord | undefined;
  if (input.exclude && input.exclude.length > 0) {
    const { balances: filtered, record } = applyExclusions(
      rawBalances,
      input.exclude,
    );
    balances = filtered;
    exclusionsRecord = record;
  }

  // PRD P1-5 — withholding: net leaf amount = gross * (10000 - bps) / 10000.
  const withholdingBps = input.withholdingBps ?? 0;
  assertBps(withholdingBps);

  const holders = deriveHolders(balances, input.ratePerShare, withholdingBps);

  if (holders.length === 0) {
    throw new Error(
      "no eligible holders found (every balance was zero at the record block, " +
        "or all eligible holders were excluded) — " +
        "check --token / --deploy-block / --record-block / --exclude",
    );
  }

  const { root, proofs } = buildProofs(input.actionId, holders);
  const totalPayout = sumPayout(holders); // Σ NET
  const totalGross = sumGross(holders); // Σ GROSS

  // Whether to surface gross/withholding fields. We track them whenever a
  // withholding rate is explicitly supplied (incl. 0) so the artifact is
  // self-describing for auditors; a plain run with no flag stays byte-for-byte
  // identical to the legacy v1 shape.
  const tracksWithholding = input.withholdingBps !== undefined;

  const claims: Record<string, ClaimEntry> = {};
  holders.forEach((holder, i) => {
    const proof = proofs[i];
    if (!proof) {
      throw new Error(`internal: missing proof for holder index ${holder.index}`);
    }
    claims[holder.account] = {
      index: holder.index,
      amount: holder.amount.toString(),
      ...(tracksWithholding ? { grossAmount: holder.grossAmount.toString() } : {}),
      proof,
    };
  });

  const metadata = normalizeMetadata(input.metadata, withholdingBps, tracksWithholding);

  const artifact: ProofsFile = {
    format: PROOFS_FORMAT,
    schemaMinor: SCHEMA_MINOR,
    actionId: input.actionId.toString(),
    chainId: input.chainId ?? 0,
    asset: getAddress(input.asset).toLowerCase() as Address,
    payoutToken: (input.payoutToken
      ? getAddress(input.payoutToken).toLowerCase()
      : "0x0000000000000000000000000000000000000000") as Address,
    ratePerShare: input.ratePerShare.toString(),
    recordBlock: Number(input.recordBlock),
    merkleRoot: root,
    totalPayout: totalPayout.toString(),
    holderCount: holders.length,
    leafEncoding: [...LEAF_ENCODING],
    ...(tracksWithholding
      ? { withholdingBps, totalGross: totalGross.toString() }
      : {}),
    ...(exclusionsRecord ? { exclusions: exclusionsRecord } : {}),
    ...(metadata ? { metadata } : {}),
    claims,
  };

  return artifact;
}

/**
 * Fold the action-level withholding into the metadata block so the resolved
 * `metadataURI` payload is self-consistent. Returns `undefined` when there is
 * nothing to record (keeps legacy artifacts clean).
 */
function normalizeMetadata(
  metadata: ActionMetadata | undefined,
  withholdingBps: number,
  tracksWithholding: boolean,
): ActionMetadata | undefined {
  const base: { -readonly [K in keyof ActionMetadata]: ActionMetadata[K] } = {
    ...(metadata ?? {}),
  };
  if (tracksWithholding && base.withholdingBps === undefined) {
    base.withholdingBps = withholdingBps;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

/**
 * Serialise an artifact to the exact JSON shape committed to the repo. We pin a
 * 2-space indent and a trailing newline so re-runs produce byte-identical files
 * (clean diffs, reproducible commits).
 */
export function serializeProofs(artifact: ProofsFile): string {
  return JSON.stringify(artifact, null, 2) + "\n";
}
