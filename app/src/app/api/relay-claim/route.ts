import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain } from "@/lib/chain";
import { addresses, distributorAbi } from "@/lib/contracts";

export const dynamic = "force-dynamic";

/**
 * Gasless claim relay. Submits `claim` on behalf of a holder using a funded
 * relayer key (server-only `RELAYER_PRIVATE_KEY`). Safe by construction: the
 * protocol's claim-on-behalf semantics send funds to `account`, never the
 * relayer — so the relayer can NEVER divert a payout.
 */
export async function POST(req: Request) {
  const relayerKey = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!relayerKey) {
    return NextResponse.json({ error: "Relayer not configured" }, { status: 503 });
  }
  if (!addresses.distributor) {
    return NextResponse.json({ error: "Distributor address unknown" }, { status: 503 });
  }

  let body: { actionId?: number; index?: number; account?: string; amount?: string; proof?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { actionId, index, account, amount, proof } = body;
  if (
    typeof actionId !== "number" ||
    typeof index !== "number" ||
    !account ||
    !isAddress(account) ||
    !amount ||
    !/^\d+$/.test(amount) ||
    !Array.isArray(proof) ||
    !proof.every((p) => isHex(p))
  ) {
    return NextResponse.json({ error: "Invalid claim payload" }, { status: 400 });
  }

  try {
    const account_ = privateKeyToAccount(relayerKey);
    const transport = http();
    const publicClient = createPublicClient({ chain: activeChain, transport });
    const walletClient = createWalletClient({ account: account_, chain: activeChain, transport });

    // Simulate first so a bad proof / already-claimed reverts BEFORE spending gas.
    const { request } = await publicClient.simulateContract({
      address: addresses.distributor,
      abi: distributorAbi,
      functionName: "claim",
      args: [BigInt(actionId), BigInt(index), account as `0x${string}`, BigInt(amount), proof as `0x${string}`[]],
      account: account_,
    });

    const txHash = await walletClient.writeContract(request);
    return NextResponse.json({ txHash });
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] : "Relay failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
