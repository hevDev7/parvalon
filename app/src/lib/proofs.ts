import { ACTIVE_CHAIN_ID } from "@/lib/chain";
import { tokenSymbol } from "@/lib/contracts";
import type { ActionLike, EligibleClaim, ProofsFile } from "@/lib/types";

const cache = new Map<number, ProofsFile | null>();

/** Fetch the published proofs artifact for an action (corporax-merkle-v1). */
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

/** All claims an address is eligible for across the currently-claimable actions. */
export async function getEligibleClaims(address: string, actions: ActionLike[]): Promise<EligibleClaim[]> {
  const addr = address.toLowerCase();
  const dividends = actions.filter((a) => a.actionType === "CASH_DIVIDEND" && a.status === "CLAIMABLE");

  const results = await Promise.all(
    dividends.map(async (a) => {
      const proofs = await fetchProofs(a.id);
      const entry = proofs?.claims?.[addr];
      if (!proofs || !entry) return null;
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
