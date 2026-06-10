import { createPublicClient, http, type PublicClient } from "viem";
import { activeChain } from "@/lib/chain";
import { addresses, registryAbi, distributorAbi, erc20Abi, tokenSymbol } from "@/lib/contracts";
import { ACTION_STATUSES, ACTION_TYPES, type ActionView } from "@/lib/types";

let _client: PublicClient | null = null;
export function publicClient(): PublicClient {
  if (!_client) {
    _client = createPublicClient({ chain: activeChain, transport: http() });
  }
  return _client;
}

const symbolCache = new Map<string, string>();

async function resolveSymbol(client: PublicClient, token: `0x${string}`): Promise<string> {
  const known = tokenSymbol(token);
  if (known && !known.endsWith("…")) return known;
  const key = token.toLowerCase();
  if (symbolCache.has(key)) return symbolCache.get(key)!;
  try {
    const sym = (await client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" })) as string;
    symbolCache.set(key, sym);
    return sym;
  } catch {
    return known;
  }
}

/** Reads every recorded action and merges distributor funding/claim totals. */
export async function readActions(): Promise<ActionView[]> {
  if (!addresses.registry || !addresses.distributor) return [];
  const client = publicClient();
  const registry = addresses.registry;
  const distributor = addresses.distributor;

  const count = Number(
    (await client.readContract({ address: registry, abi: registryAbi, functionName: "actionCount" })) as bigint,
  );
  if (count === 0) return [];

  const ids = Array.from({ length: count }, (_, i) => BigInt(i + 1));

  const out = await Promise.all(
    ids.map(async (id) => {
      const a = (await client.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "getAction",
        args: [id],
      })) as {
        id: bigint;
        asset: `0x${string}`;
        actionType: number;
        ratePerShare: bigint;
        recordBlock: bigint;
        payableAt: bigint;
        claimDeadline: bigint;
        payoutToken: `0x${string}`;
        merkleRoot: `0x${string}`;
        totalPayout: bigint;
        status: number;
        metadataURI: string;
      };

      const [funded, claimed] = await Promise.all([
        client
          .readContract({ address: distributor, abi: distributorAbi, functionName: "totalFunded", args: [id] })
          .catch(() => 0n) as Promise<bigint>,
        client
          .readContract({ address: distributor, abi: distributorAbi, functionName: "totalClaimed", args: [id] })
          .catch(() => 0n) as Promise<bigint>,
      ]);

      const [assetSymbol, payoutSymbol] = await Promise.all([
        resolveSymbol(client, a.asset),
        a.payoutToken === "0x0000000000000000000000000000000000000000"
          ? Promise.resolve("—")
          : resolveSymbol(client, a.payoutToken),
      ]);

      const view: ActionView = {
        id: Number(a.id),
        asset: a.asset,
        assetSymbol,
        actionType: ACTION_TYPES[a.actionType] ?? "CASH_DIVIDEND",
        status: ACTION_STATUSES[a.status] ?? "ANNOUNCED",
        ratePerShareWei: a.ratePerShare.toString(),
        recordBlock: Number(a.recordBlock),
        payableAt: Number(a.payableAt),
        claimDeadline: Number(a.claimDeadline),
        payoutToken: a.payoutToken,
        payoutSymbol,
        merkleRoot: a.merkleRoot,
        totalPayoutWei: a.totalPayout.toString(),
        totalFundedWei: funded.toString(),
        totalClaimedWei: claimed.toString(),
        metadataURI: a.metadataURI,
      };
      return view;
    }),
  );

  return out.sort((x, y) => y.id - x.id);
}
