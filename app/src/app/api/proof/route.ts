import type { NextRequest } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ACTIVE_CHAIN_ID } from "@/lib/chain";

/**
 * Per-holder Merkle proof lookup.
 *
 *   GET /api/proof?actionId=2&account=0x..&chainId=46630
 *
 * Large dividends (e.g. the real TSLA snapshot has 184k holders → a 264 MB
 * proofs.json) can't be shipped to the browser. This route returns ONLY the
 * requesting holder's `{ index, amount, proof }`, reading from a sharded store
 * server-side so the big artifact never crosses the wire.
 *
 * Store resolution (first hit wins):
 *   1. sharded:    $PROOFS_DIR/<chainId>-<actionId>/<addrPrefix>.json  (big actions)
 *   2. whole file: proofs-<chainId>-<actionId>.json under the store, the app's
 *      public/deployments, or the repo deployments/ dir            (small actions)
 *
 * `PROOFS_DIR` defaults to the repo-relative `.proofs-store` (gitignored). Build
 * shards with `tooling/snapshot/shard-proofs.mjs`.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Entry = { index: number; amount: string; proof: `0x${string}`[]; grossAmount?: string };

// process.cwd() is the app workspace dir when `next` runs; the store sits at repo root.
const PROOFS_DIR = process.env.PROOFS_DIR?.trim() || join(process.cwd(), "..", ".proofs-store");
const ADDR = /^0x[0-9a-fA-F]{40}$/;

const shardCache = new Map<string, Record<string, Entry> | null>();
const wholeCache = new Map<string, Record<string, Entry> | null>();

function readJson(path: string): unknown {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function loadShard(chainId: number, actionId: number, prefix: string): Record<string, Entry> | null {
  const key = `${chainId}-${actionId}/${prefix}`;
  const hit = shardCache.get(key);
  if (hit !== undefined) return hit;
  const data = readJson(join(PROOFS_DIR, `${chainId}-${actionId}`, `${prefix}.json`)) as Record<string, Entry> | null;
  shardCache.set(key, data);
  return data;
}

function loadWhole(chainId: number, actionId: number): Record<string, Entry> | null {
  const key = `${chainId}-${actionId}`;
  const hit = wholeCache.get(key);
  if (hit !== undefined) return hit;
  const candidates = [
    join(PROOFS_DIR, `proofs-${chainId}-${actionId}.json`),
    join(process.cwd(), "public", "deployments", `proofs-${chainId}-${actionId}.json`),
    join(process.cwd(), "..", "deployments", `proofs-${chainId}-${actionId}.json`),
  ];
  let claims: Record<string, Entry> | null = null;
  for (const p of candidates) {
    const data = readJson(p) as { claims?: Record<string, Entry> } | null;
    if (data?.claims) {
      claims = data.claims;
      break;
    }
  }
  wholeCache.set(key, claims);
  return claims;
}

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  const actionId = Number(sp.get("actionId"));
  const account = (sp.get("account") ?? "").toLowerCase();
  const chainId = Number(sp.get("chainId") ?? ACTIVE_CHAIN_ID);

  if (!Number.isInteger(actionId) || actionId <= 0 || !ADDR.test(account) || !Number.isInteger(chainId)) {
    return Response.json({ error: "expected ?actionId=<int>&account=0x..(&chainId=<int>)" }, { status: 400 });
  }

  const prefix = account.slice(2, 4);
  const entry = loadShard(chainId, actionId, prefix)?.[account] ?? loadWhole(chainId, actionId)?.[account];

  const headers = { "cache-control": "private, max-age=30" };
  if (!entry) {
    return Response.json({ eligible: false }, { status: 200, headers });
  }
  return Response.json(
    { eligible: true, chainId, actionId, account, index: entry.index, amount: entry.amount, proof: entry.proof },
    { status: 200, headers },
  );
}
