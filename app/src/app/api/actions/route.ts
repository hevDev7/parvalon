import { NextResponse } from "next/server";
import { formatUnits } from "viem";
import { ACTIVE_CHAIN_ID, explorerAddressUrl } from "@/lib/chain";
import { tokenDecimals } from "@/lib/tokens";
import { readActions } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Public CAE-1 action feed (see docs/INTEGRATION.md §10). This is the
 * machine-readable endpoint integrating protocols and AI agents consume to react
 * to corporate actions. Amounts are human-decimal strings; raw wei stays on-chain.
 */
export async function GET() {
  try {
    const actions = await readActions();
    const payload = {
      chainId: ACTIVE_CHAIN_ID,
      generatedAt: new Date().toISOString(),
      schema: "CAE-1",
      count: actions.length,
      actions: actions.map((a) => ({
        id: a.id,
        asset: a.asset,
        assetSymbol: a.assetSymbol,
        actionType: a.actionType,
        status: a.status,
        ratePerShare: formatUnits(BigInt(a.ratePerShareWei || "0"), tokenDecimals(a.payoutToken)),
        ratePerShareWei: a.ratePerShareWei,
        recordBlock: a.recordBlock,
        payableAt: a.payableAt,
        claimDeadline: a.claimDeadline,
        payoutToken: a.payoutToken,
        payoutSymbol: a.payoutSymbol,
        merkleRoot: a.merkleRoot,
        totalPayout: formatUnits(BigInt(a.totalPayoutWei || "0"), tokenDecimals(a.payoutToken)),
        totalFunded: formatUnits(BigInt(a.totalFundedWei || "0"), tokenDecimals(a.payoutToken)),
        totalClaimed: formatUnits(BigInt(a.totalClaimedWei || "0"), tokenDecimals(a.payoutToken)),
        metadataURI: a.metadataURI,
        explorerUrl: explorerAddressUrl(a.asset),
      })),
    };
    return NextResponse.json(payload, {
      headers: { "cache-control": "public, max-age=5, stale-while-revalidate=30" },
    });
  } catch {
    // Don't leak the RPC host / internal detail to callers.
    return NextResponse.json({ error: "Failed to read actions", actions: [] }, { status: 500 });
  }
}
