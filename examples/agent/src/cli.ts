#!/usr/bin/env node
/**
 * Parvalon example agent CLI.
 *
 * Commands:
 *   watch   Subscribe to the registry's ActionAnnounced (CAE-1) and print a
 *           strategy decision per event. Needs a live RPC + registry address.
 *
 *   demo    Run the pure decision core against a synthetic ActionAnnounced for
 *           each ActionType — NO chain, NO RPC. Also demonstrates the
 *           illustrative x402 pay-per-call flow. This is the zero-dependency
 *           "see it work" path.
 *
 * Config resolution (watch): env first, then deployments/<chainId>.json.
 *   NEXT_PUBLIC_RPC_URL | RPC_URL, NEXT_PUBLIC_REGISTRY_ADDRESS,
 *   NEXT_PUBLIC_CHAIN_ID, AGENT_HOLDINGS (JSON {asset: units}).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

import {
  decideOnAnnouncement,
  formatUnits,
} from "./strategy.js";
import {
  resolveConfig,
  makeClient,
  watchAnnouncements,
  type DeploymentsFile,
} from "./agent.js";
import { payForData } from "./x402.js";
import {
  ActionType,
  type ActionAnnouncedEvent,
  type Holdings,
  type StrategyDecision,
} from "./types.js";

const out = (msg: string): void => void process.stdout.write(msg + "\n");
const err = (msg: string): void => void process.stderr.write(msg + "\n");

const HERE = dirname(fileURLToPath(import.meta.url));

/** Pretty-print one decision to stdout. */
function printDecision(d: StrategyDecision): void {
  out("");
  out(`── action #${d.actionId}  [${d.actionType}]  ${d.holds ? "HELD" : "not held"} ──`);
  out(`   decision: ${d.kind}`);
  if (d.eligibleClaim !== undefined) {
    out(`   eligible claim: ${formatUnits(d.eligibleClaim)} payout-token units`);
  }
  for (const line of d.rationale) out(`   • ${line}`);
  if (d.nextActions.length > 0) {
    out(`   next:`);
    for (const a of d.nextActions) out(`     → ${a}`);
  }
}

/**
 * Load deployments/<chainId>.json from the monorepo if present. Best-effort:
 * returns undefined when not found so env-only config still works.
 */
function loadDeployments(chainId: number): DeploymentsFile | undefined {
  const candidates = [
    resolve(HERE, `../../../deployments/${chainId}.json`),
    resolve(process.cwd(), `deployments/${chainId}.json`),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as DeploymentsFile;
    } catch {
      // try next
    }
  }
  return undefined;
}

/** Build the set of synthetic events the demo runs through. */
function syntheticEvents(asset: `0x${string}`): ActionAnnouncedEvent[] {
  return [
    {
      id: 1n,
      asset,
      actionType: ActionType.CASH_DIVIDEND,
      ratePerShare: 500_000_000_000_000_000n, // 0.5
      recordBlock: 1234n,
      payableAt: 1781110880n,
      claimDeadline: 1781715680n,
      payoutToken: getAddress("0x5FbDB2315678afecb367f032d93F642f64180aa3"),
      metadataURI: "ipfs://demo-cash-dividend",
    },
    {
      id: 2n,
      asset,
      actionType: ActionType.STOCK_SPLIT,
      ratePerShare: 0n,
      recordBlock: 1300n,
      payableAt: 0n,
      claimDeadline: 0n,
      payoutToken: "0x0000000000000000000000000000000000000000",
      metadataURI: "ipfs://demo-4-for-1-split",
    },
    {
      id: 3n,
      asset,
      actionType: ActionType.STOCK_DIVIDEND,
      ratePerShare: 0n,
      recordBlock: 1400n,
      payableAt: 0n,
      claimDeadline: 0n,
      payoutToken: "0x0000000000000000000000000000000000000000",
      metadataURI: "ipfs://demo-stock-dividend",
    },
  ];
}

async function runDemo(): Promise<void> {
  // TSLA on local 31337 (deployments/31337.json). Pretend we hold 14 shares.
  const tsla = getAddress("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
  const holdings: Holdings = { [tsla.toLowerCase()]: 14n * 10n ** 18n };

  out("Parvalon example agent — DEMO (synthetic events, no chain)");
  out(`book: holding 14 TSLA (${tsla})`);

  for (const event of syntheticEvents(tsla)) {
    printDecision(decideOnAnnouncement(event, holdings));
  }

  out("");
  out("── x402 premium feed (ILLUSTRATIVE STUB — no funds move) ──");
  const result = await payForData({
    url: "https://premium.example/api/insight",
    asset: tsla,
    budget: 50_000n,
  });
  out(`   402 challenge: pay ${result.challenge.maxAmountRequired} base units ` +
    `of ${result.challenge.asset} on chain ${result.challenge.network}`);
  out(`   settled (stub) tx: ${result.receipt.txHash}`);
  out(`   premium insight: forecast ex-date ${result.insight.forecastExDate}, ` +
    `expected rate ${formatUnits(result.insight.expectedRatePerShare)}`);
  out(`   note: ${result.insight.notes}`);
  out("");
  out("Demo complete. Run `npm run watch` against a live RPC for the real subscription.");
}

async function runWatch(): Promise<void> {
  const probeChainId = process.env.NEXT_PUBLIC_CHAIN_ID
    ? Number(process.env.NEXT_PUBLIC_CHAIN_ID)
    : 31337;
  const deployments = loadDeployments(probeChainId);
  const config = resolveConfig(process.env, deployments);

  err(`[agent] chain ${config.chainId} · registry ${config.registry} · rpc ${config.rpcUrl}`);
  err(`[agent] holdings: ${JSON.stringify(
    Object.fromEntries(
      Object.entries(config.holdings).map(([k, v]) => [k, v.toString()]),
    ),
  )}`);
  err("[agent] watching ActionAnnounced … (Ctrl-C to stop)");

  const client = makeClient(config);
  const unwatch = watchAnnouncements(client, config, (decision) => {
    printDecision(decision);
  });

  process.on("SIGINT", () => {
    err("\n[agent] stopping.");
    unwatch();
    process.exit(0);
  });
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "demo";
  switch (command) {
    case "demo":
      await runDemo();
      return;
    case "watch":
      await runWatch();
      return;
    default:
      err(`unknown command: ${command}`);
      err("usage: corporax-agent [demo|watch]");
      process.exit(2);
  }
}

main().catch((e: unknown) => {
  err(`[agent] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
