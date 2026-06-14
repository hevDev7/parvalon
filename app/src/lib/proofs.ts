import { ACTIVE_CHAIN_ID } from "@/lib/chain";
import { tokenSymbol } from "@/lib/contracts";
import type { ActionLike, EligibleClaim, ProofsFile } from "@/lib/types";

const cache = new Map<number, ProofsFile | null>();

/**
 * Fetch the FULL published proofs artifact for an action (corporax-merkle-v1).
 * Only viable for small actions whose proofs.json is bundled under
 * /deployments. Large actions (e.g. the 184k-holder TSLA snapshot) must use
 * {@link fetchProofEntry}, which returns one holder's proof via /api/proof.
 */
export async function fetchProofs(actionId: number): Promise<ProofsFile | null> {
  if (cache.has(actionId)) return cache.get(actionId)!;
  try {
    const res = await fetch(`/deployments/proofs-${ACTIVE_CHAIN_ID}-${actionId}.json`, { cache: "no-store" });
    if (!res.ok) {
      cache.set(actionId, null);
      return null;
    }
    const data = (await res.json()) as ProofsFile;
    cache.set(actionId, data);
    return data;
  } catch {
    cache.set(actionId, null);
    return null;
  }
}

type ProofEntry = { index: number; amount: string; proof: `0x${string}`[] };

/**
 * Per-holder proof lookup via the server route — scales to arbitrarily large
 * holder sets (the big artifact never reaches the browser). Returns null when
 * the address has no claim for the action.
 */
export async function fetchProofEntry(actionId: number, account: string): Promise<ProofEntry | null> {
  try {
    const res = await fetch(
      `/api/proof?actionId=${actionId}&account=${account}&chainId=${ACTIVE_CHAIN_ID}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { eligible?: boolean; index?: number; amount?: string; proof?: `0x${string}`[] };
    if (!data.eligible || data.index === undefined || data.amount === undefined || !data.proof) return null;
    return { index: data.index, amount: data.amount, proof: data.proof };
  } catch {
    return null;
  }
}

/** All claims an address is eligible for across the currently-claimable actions. */
export async function getEligibleClaims(address: string, actions: ActionLike[]): Promise<EligibleClaim[]> {
  const addr = address.toLowerCase();
  const dividends = actions.filter((a) => a.actionType === "CASH_DIVIDEND" && a.status === "CLAIMABLE");

  const results = await Promise.all(
    dividends.map(async (a) => {
      const entry = await fetchProofEntry(a.id, addr);
      if (!entry) return null;
      const claim: EligibleClaim = {
        actionId: a.id,
        index: entry.index,
        account: address as `0x${string}`,
        amountWei: entry.amount,
        proof: entry.proof,
        payoutToken: a.payoutToken,
        payoutSymbol: a.payoutSymbol || tokenSymbol(a.payoutToken),
        assetSymbol: a.assetSymbol,
        metadataURI: a.metadataURI,
        status: a.status,
      };
      return claim;
    }),
  );

  return results.filter((c): c is EligibleClaim => c !== null);
}
