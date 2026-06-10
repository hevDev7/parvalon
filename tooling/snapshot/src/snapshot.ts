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
  LEAF_ENCODING,
  type Address,
  type BalanceProvider,
  type ClaimEntry,
  type Holder,
  type ProofsFile,
  type SnapshotInput,
} from "./types.js";
import { buildProofs } from "./merkle.js";

const ONE_E18 = 10n ** 18n;

/**
 * Turn a raw balance map into the deterministic, sorted list of eligible
 * holders with their payout amounts and bitmap indices.
 *
 * Determinism is the core selling point, so every step is order-stable:
 *   1. drop the zero address and any non-positive balance,
 *   2. sort by address ascending (byte order on the 20-byte value),
 *   3. assign 0-based `index` in that sorted order,
 *   4. `amount = balance * ratePerShare / 1e18` (floor division, BigInt).
 *
 * Two runs over the same chain state therefore yield identical indices, amounts,
 * and — because the leaf set is identical — an identical Merkle root.
 */
export function deriveHolders(
  balances: Map<Address, bigint>,
  ratePerShare: bigint,
): Holder[] {
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

  return eligible.map(({ account, balance }, index) => ({
    account,
    balance,
    index,
    amount: (balance * ratePerShare) / ONE_E18,
  }));
}

/** Sum of all holder payout amounts — the exact funding target. */
export function sumPayout(holders: readonly Holder[]): bigint {
  return holders.reduce((acc, h) => acc + h.amount, 0n);
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
  const balances = await provider.balancesAt(input);
  const holders = deriveHolders(balances, input.ratePerShare);

  if (holders.length === 0) {
    throw new Error(
      "no eligible holders found (every balance was zero at the record block) — " +
        "check --token / --deploy-block / --record-block",
    );
  }

  const { root, proofs } = buildProofs(input.actionId, holders);
  const totalPayout = sumPayout(holders);

  const claims: Record<string, ClaimEntry> = {};
  holders.forEach((holder, i) => {
    const proof = proofs[i];
    if (!proof) {
      throw new Error(`internal: missing proof for holder index ${holder.index}`);
    }
    claims[holder.account] = {
      index: holder.index,
      amount: holder.amount.toString(),
      proof,
    };
  });

  const artifact: ProofsFile = {
    format: PROOFS_FORMAT,
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
    claims,
  };

  return artifact;
}

/**
 * Serialise an artifact to the exact JSON shape committed to the repo. We pin a
 * 2-space indent and a trailing newline so re-runs produce byte-identical files
 * (clean diffs, reproducible commits).
 */
export function serializeProofs(artifact: ProofsFile): string {
  return JSON.stringify(artifact, null, 2) + "\n";
}
