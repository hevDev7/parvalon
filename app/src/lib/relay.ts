import type { EligibleClaim } from "@/lib/types";

/** True when a server-side relayer is configured (gasless claims available). */
export const gaslessEnabled = process.env.NEXT_PUBLIC_GASLESS_ENABLED === "true";

export interface RelayResult {
  txHash: `0x${string}`;
}

/**
 * Submit a gasless claim. Because the protocol's `claim` is claim-on-behalf
 * (FR-6) — funds always settle to `account`, never the submitter — a relayer can
 * pay gas for the holder with zero custody risk. The server route validates and
 * forwards the call.
 */
export async function relayClaim(claim: EligibleClaim): Promise<RelayResult> {
  const res = await fetch("/api/relay-claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actionId: claim.actionId,
      index: claim.index,
      account: claim.account,
      amount: claim.amountWei,
      proof: claim.proof,
    }),
  });
  const data = (await res.json()) as RelayResult & { error?: string };
  if (!res.ok) throw new Error(data.error || "Relay failed");
  return data;
}
