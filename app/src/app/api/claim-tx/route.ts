import type { NextRequest } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, http, parseAbiItem } from "viem";
import { ACTIVE_CHAIN_ID, activeChain } from "@/lib/chain";
import { addresses } from "@/lib/contracts";

/**
 * Resolve the on-chain `Claimed` transaction for a (actionId, account) pair so
 * the /claim history can link each "Paid" row to its explorer receipt.
 *
 *   GET /api/claim-tx?actionId=2&account=0x..&chainId=46630  ->  { txHash, blockNumber }
 *
 * Claims for an action only occur once it's CLAIMABLE (≥ its record block), so we
 * scan the `Claimed` logs backward from head down to the record block (read from
 * the proofs store), filtered by the indexed id+account — usually one window.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CLAIMED = parseAbiItem(
  "event Claimed(uint256 indexed id, uint256 index, address indexed account, uint256 amount)",
);
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const PROOFS_DIR = process.env.PROOFS_DIR?.trim() || join(process.cwd(), "..", ".proofs-store");
const WINDOW = 9000n; // ≤ provider getLogs block-range limit
const MAX_SPAN = 2_000_000n; // safety floor when the record block is unknown

// Server-only RPC: prefer a dedicated/archive endpoint if configured, else the app chain RPC.
const RPC = process.env.CLAIMTX_RPC?.trim() || process.env.ALCHEMY_RPC?.trim();
const client = RPC
  ? createPublicClient({ transport: http(RPC) })
  : createPublicClient({ chain: activeChain, transport: http() });

const cache = new Map<string, { txHash: `0x${string}`; blockNumber: number } | null>();

function recordBlockOf(chainId: number, actionId: number): bigint | null {
  const candidates = [
    join(PROOFS_DIR, `${chainId}-${actionId}`, "meta.json"),
    join(PROOFS_DIR, `proofs-${chainId}-${actionId}.json`),
    join(process.cwd(), "public", "deployments", `proofs-${chainId}-${actionId}.json`),
    join(process.cwd(), "..", "deployments", `proofs-${chainId}-${actionId}.json`),
  ];
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const d = JSON.parse(readFileSync(p, "utf8")) as { recordBlock?: number };
      if (typeof d.recordBlock === "number") return BigInt(d.recordBlock);
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  const actionId = Number(sp.get("actionId"));
  const account = (sp.get("account") ?? "").toLowerCase() as `0x${string}`;
  const chainId = Number(sp.get("chainId") ?? ACTIVE_CHAIN_ID);
  if (!Number.isInteger(actionId) || actionId <= 0 || !ADDR.test(account)) {
    return Response.json({ error: "expected ?actionId=<int>&account=0x.." }, { status: 400 });
  }
  const distributor = addresses.distributor;
  if (!distributor) return Response.json({ found: false }, { status: 200 });

  const key = `${chainId}-${actionId}-${account}`;
  if (cache.has(key)) {
    const hit = cache.get(key)!;
    return Response.json(hit ? { found: true, ...hit } : { found: false }, { status: 200 });
  }

  try {
    const head = await client.getBlockNumber();
    const floor = recordBlockOf(chainId, actionId) ?? (head > MAX_SPAN ? head - MAX_SPAN : 0n);
    let to = head;
    while (to >= floor) {
      const from = to - WINDOW + 1n > floor ? to - WINDOW + 1n : floor;
      const logs = await client.getLogs({
        address: distributor,
        event: CLAIMED,
        args: { id: BigInt(actionId), account },
        fromBlock: from,
        toBlock: to,
        strict: true,
      });
      if (logs.length > 0) {
        const l = logs[logs.length - 1]!;
        const out = { txHash: l.transactionHash as `0x${string}`, blockNumber: Number(l.blockNumber) };
        cache.set(key, out);
        return Response.json({ found: true, ...out }, { status: 200, headers: { "cache-control": "private, max-age=300" } });
      }
      if (from === floor) break;
      to = from - 1n;
    }
    cache.set(key, null);
    return Response.json({ found: false }, { status: 200, headers: { "cache-control": "private, max-age=60" } });
  } catch {
    // Transient RPC issue — don't cache, let the client retry.
    return Response.json({ found: false }, { status: 200 });
  }
}
