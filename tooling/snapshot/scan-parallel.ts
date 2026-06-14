/**
 * Parallel snapshot scanner — exploits a high-throughput RPC (e.g. Alchemy PAYG)
 * to fetch a token's full Transfer history concurrently, then reuses the tested
 * `@parvalon/snapshot` balance/merkle/format code to emit a canonical proofs.json.
 *
 * Why: the stock token has ~75M blocks of history and the RPC caps eth_getLogs at
 * a 10k-block range, so a sequential scan is ~1h. Transfer folding is order-free
 * and additive, so disjoint block windows can be fetched in parallel and merged.
 *
 * Config via env (no secrets committed — pass the RPC at run time):
 *   ALCHEMY_RPC  RPC url (required)            ASSET        token address
 *   RECORD_BLOCK snapshot height              RATE          ratePerShare (base units)
 *   ACTION_ID    corporate action id          PAYOUT_TOKEN  payout token (written to artifact)
 *   OUT          output path                  DEPLOY_BLOCK  scan lower bound (default 0)
 *   CHAIN_ID     default 46630                WINDOW        blocks/request (default 10000)
 *   CONCURRENCY  parallel requests (default 40)
 */
import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbiItem, getAddress, type Hex } from "viem";
import { foldTransfers, generateSnapshot, serializeProofs } from "./src/index.js";
import type { Address, BalanceProvider, SnapshotInput } from "./src/index.js";

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const RPC = process.env.ALCHEMY_RPC ?? need("RPC_URL");
const asset = getAddress(need("ASSET"));
const deployBlock = BigInt(process.env.DEPLOY_BLOCK ?? "0");
const recordBlock = BigInt(need("RECORD_BLOCK"));
const ratePerShare = BigInt(need("RATE"));
const actionId = BigInt(need("ACTION_ID"));
const chainId = Number(process.env.CHAIN_ID ?? "46630");
const payoutToken = process.env.PAYOUT_TOKEN ? getAddress(process.env.PAYOUT_TOKEN) : undefined;
const out = need("OUT");
const WINDOW = BigInt(process.env.WINDOW ?? "10000");
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "40");

const client = createPublicClient({
  transport: http(RPC, { timeout: 60_000, retryCount: 2 }),
});

const log = (m: string): void => void process.stderr.write(m + "\n");

// Build the disjoint windows up front.
const windows: Array<[bigint, bigint]> = [];
for (let from = deployBlock; from <= recordBlock; from += WINDOW) {
  const to = from + WINDOW - 1n < recordBlock ? from + WINDOW - 1n : recordBlock;
  windows.push([from, to]);
}
log(`[parallel] ${windows.length} windows × ${WINDOW} blocks, concurrency ${CONCURRENCY}`);

type Xfer = { from: Address; to: Address; value: bigint };
const all: Xfer[] = [];
let done = 0;

async function fetchWindow(from: bigint, to: bigint, attempt = 0): Promise<void> {
  try {
    const logs = await client.getLogs({ address: asset, event: TRANSFER, fromBlock: from, toBlock: to, strict: true });
    for (const l of logs) {
      const a = l.args;
      if (a.from === undefined || a.to === undefined || a.value === undefined) continue;
      all.push({ from: a.from.toLowerCase() as Address, to: a.to.toLowerCase() as Address, value: a.value });
    }
    if (++done % 250 === 0 || done === windows.length) {
      log(`[parallel] ${done}/${windows.length} windows · ${all.length} transfers`);
    }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
    // Too many results / range complaint → split the window and recurse.
    if (to > from && (msg.includes("more than") || msg.includes("range") || msg.includes("limit") || msg.includes("10000"))) {
      const mid = from + (to - from) / 2n;
      await fetchWindow(from, mid);
      await fetchWindow(mid + 1n, to);
      return;
    }
    if (attempt < 7) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 300));
      return fetchWindow(from, to, attempt + 1);
    }
    throw new Error(`window ${from}-${to} failed: ${msg}`);
  }
}

// Bounded-concurrency pool over the window list.
let idx = 0;
async function worker(): Promise<void> {
  while (idx < windows.length) {
    const i = idx++;
    const w = windows[i]!;
    await fetchWindow(w[0], w[1]);
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
log(`[parallel] fetched ${all.length} transfers in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Reuse the tested pipeline: fold → deriveHolders → merkle → canonical proofs.json.
const balances = foldTransfers(all);
const provider: BalanceProvider = { balancesAt: async () => balances };
const input: SnapshotInput = {
  rpcUrl: RPC,
  asset: asset as Address,
  deployBlock,
  recordBlock,
  ratePerShare,
  actionId,
  chunkSize: WINDOW,
  chainId,
  ...(payoutToken ? { payoutToken: payoutToken as Address } : {}),
};
const artifact = await generateSnapshot(input, provider);
writeFileSync(out, serializeProofs(artifact));
log(`[parallel] holders=${artifact.holderCount} totalPayout=${artifact.totalPayout} root=${artifact.merkleRoot as Hex}`);
process.stdout.write(out + "\n");
