import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain } from "@/lib/chain";
import { addresses, distributorAbi } from "@/lib/contracts";
import { checkRateLimit, clientKey } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** A bytes32 Merkle node depth this far exceeds any realistic holder set (2^64). */
const MAX_PROOF_LEN = 64;
/** Hard cap on the request body so a flood can't force large JSON parses. */
const MAX_BODY_BYTES = 16_384;

/**
 * Gasless claim relay. Submits `claim` on behalf of a holder using a funded
 * relayer key (server-only `RELAYER_PRIVATE_KEY`). Safe by construction: the
 * protocol's claim-on-behalf semantics send funds to `account`, never the
 * relayer — so the relayer can NEVER divert a payout. This endpoint is open, so
 * it is rate-limited and size-capped to bound gas/RPC cost and availability abuse;
 * it never returns internal/RPC error detail.
 */
export async function POST(req: Request) {
  const relayerKey = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!relayerKey) {
    return NextResponse.json({ error: "Relayer not configured" }, { status: 503 });
  }
  if (!addresses.distributor) {
    return NextResponse.json({ error: "Distributor address unknown" }, { status: 503 });
  }

  // Abuse brake: count this attempt before doing any RPC work.
  const rl = checkRateLimit(clientKey(req));
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  // Reject oversized bodies up front (header is advisory; the field checks below
  // are the real bound on work performed).
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
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
    !Number.isInteger(actionId) ||
    actionId < 0 ||
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    !account ||
    !isAddress(account) ||
    !amount ||
    !/^\d{1,78}$/.test(amount) ||
    !Array.isArray(proof) ||
    proof.length > MAX_PROOF_LEN ||
    !proof.every((p) => typeof p === "string" && p.length === 66 && isHex(p))
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
    // Never leak the RPC host or internal error detail. Surface only a coarse,
    // safe reason derived from known on-chain revert names.
    return NextResponse.json({ error: safeRelayError(err) }, { status: 400 });
  }
}

/** Map an internal relay/simulation error to a non-sensitive, UI-friendly message. */
function safeRelayError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  const known: Array<[RegExp, string]> = [
    [/AlreadyClaimed/, "Already claimed"],
    [/InvalidProof/, "Invalid Merkle proof"],
    [/NotYetClaimable/, "Not yet claimable"],
    [/WrongStatus/, "Action is not claimable"],
    [/ExceedsFunded|NotADividend/, "Claim not currently fundable"],
  ];
  for (const [re, msg] of known) if (re.test(raw)) return msg;
  return "Claim could not be relayed";
}
