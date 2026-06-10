#!/usr/bin/env node
/**
 * `corporax-snapshot` — the CorporaX Merkle snapshot CLI.
 *
 * Two commands:
 *
 *   snapshot   Reconstruct holder balances at a record block from on-chain
 *              Transfer logs and emit a canonical `corporax-merkle-v1`
 *              proofs.json (INTEGRATION.md §5).
 *
 *   verify     Re-derive the root from an existing proofs.json and assert every
 *              proof verifies and Σ amount == totalPayout. Exits non-zero on any
 *              mismatch — suitable as a CI gate.
 *
 * stdout is reserved for the artifact path / machine-readable summary; all
 * progress and diagnostics go to stderr.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createPublicClient, http, getAddress, isAddress } from "viem";
import { Command, InvalidArgumentError } from "commander";

import type { Address, ProofsFile, SnapshotInput } from "./types.js";
import { RpcBalanceProvider } from "./balances.js";
import { generateSnapshot, serializeProofs } from "./snapshot.js";
import { verifyProofs } from "./verify.js";

const err = (msg: string): void => void process.stderr.write(msg + "\n");
const out = (msg: string): void => void process.stdout.write(msg + "\n");

/* ------------------------------ arg parsers ------------------------------- */

function parseAddressArg(value: string): Address {
  if (!isAddress(value)) {
    throw new InvalidArgumentError(`not a valid address: ${value}`);
  }
  return getAddress(value).toLowerCase() as Address;
}

function parseBigIntArg(value: string): bigint {
  try {
    const v = BigInt(value);
    if (v < 0n) throw new Error("negative");
    return v;
  } catch {
    throw new InvalidArgumentError(`expected a non-negative integer, got: ${value}`);
  }
}

/* -------------------------------- program --------------------------------- */

const program = new Command();
program
  .name("corporax-snapshot")
  .description(
    "Deterministic Merkle snapshot generator for CorporaX corporate actions.",
  )
  .version("1.0.0");

program
  .command("snapshot")
  .description(
    "Reconstruct holder balances at --record-block from Transfer logs and write proofs.json",
  )
  .requiredOption("--token <addr>", "ERC20 asset address to snapshot", parseAddressArg)
  .requiredOption("--deploy-block <n>", "token deploy block (scan lower bound)", parseBigIntArg)
  .requiredOption("--record-block <n>", "record block (snapshot height, inclusive)", parseBigIntArg)
  .requiredOption("--rate <wei>", "ratePerShare in wei (per 1e18 shares)", parseBigIntArg)
  .requiredOption("--action-id <n>", "corporate action id this snapshot is for", parseBigIntArg)
  .requiredOption("--out <path>", "output path for proofs.json")
  .option("--rpc <url>", "RPC URL (overrides $RPC_URL)")
  // No commander default: it would JSON.stringify a BigInt in --help (throws),
  // and a string default fights the parser's bigint return type. We default to
  // 5000n in code below when the flag is absent.
  .option("--chunk <n>", "eth_getLogs page size in blocks (default: 5000)", parseBigIntArg)
  .option("--payout-token <addr>", "payout token address (written into the artifact)", parseAddressArg)
  .option("--chain-id <n>", "chain id to record (defaults to the RPC's reported id)", parseBigIntArg)
  .action(async (opts) => {
    try {
      await runSnapshot(opts);
    } catch (e) {
      err(`[snapshot] ERROR: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  });

program
  .command("verify")
  .description(
    "Re-derive the root from a proofs.json and assert every proof + the payout total. Exits non-zero on mismatch.",
  )
  .argument("<proofs.json>", "path to a corporax-merkle-v1 artifact")
  .action((path: string) => {
    try {
      runVerify(path);
    } catch (e) {
      err(`[verify] ERROR: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  });

/* ------------------------------ subcommands ------------------------------- */

interface SnapshotOpts {
  token: Address;
  deployBlock: bigint;
  recordBlock: bigint;
  rate: bigint;
  actionId: bigint;
  out: string;
  rpc?: string;
  /** Parsed bigint when --chunk is supplied; undefined → default 5000n. */
  chunk?: bigint;
  payoutToken?: Address;
  chainId?: bigint;
}

async function runSnapshot(opts: SnapshotOpts): Promise<void> {
  const rpcUrl = opts.rpc ?? process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error("no RPC URL — pass --rpc <url> or set $RPC_URL");
  }

  // Resolve the chain id from the node unless explicitly overridden, so the
  // artifact's chainId matches reality without an extra required flag.
  const client = createPublicClient({ transport: http(rpcUrl) });
  let chainId: number;
  if (opts.chainId !== undefined) {
    chainId = Number(opts.chainId);
  } else {
    err("[snapshot] querying chain id from RPC...");
    chainId = await client.getChainId();
  }

  const chunkSize = opts.chunk ?? 5000n;

  const input: SnapshotInput = {
    rpcUrl,
    asset: opts.token,
    deployBlock: opts.deployBlock,
    recordBlock: opts.recordBlock,
    ratePerShare: opts.rate,
    actionId: opts.actionId,
    chunkSize,
    chainId,
    ...(opts.payoutToken !== undefined ? { payoutToken: opts.payoutToken } : {}),
  };

  err(
    `[snapshot] asset=${input.asset} blocks=${input.deployBlock}..${input.recordBlock} ` +
      `rate=${input.ratePerShare} actionId=${input.actionId} chainId=${chainId}`,
  );

  const provider = new RpcBalanceProvider(client, { log: err });
  const artifact = await generateSnapshot(input, provider);

  const outPath = resolve(opts.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serializeProofs(artifact), "utf8");

  err(
    `[snapshot] holders=${artifact.holderCount} ` +
      `totalPayout=${artifact.totalPayout} root=${artifact.merkleRoot}`,
  );
  err(`[snapshot] wrote ${outPath}`);
  // stdout: just the path, so callers can capture it cleanly.
  out(outPath);
}

function runVerify(path: string): void {
  const abs = resolve(path);
  const raw = readFileSync(abs, "utf8");
  let file: ProofsFile;
  try {
    file = JSON.parse(raw) as ProofsFile;
  } catch (e) {
    throw new Error(`could not parse JSON at ${abs}: ${e instanceof Error ? e.message : e}`);
  }

  const result = verifyProofs(file);

  err(
    `[verify] ${abs}: checked ${result.checked} proof(s), ` +
      `root=${file.merkleRoot}`,
  );
  if (result.recomputedRoot) {
    err(`[verify] recomputed root=${result.recomputedRoot}`);
  }

  if (result.ok) {
    err(`[verify] OK — all proofs valid, Σ amount == totalPayout`);
    out("OK");
    return;
  }

  for (const issue of result.issues) {
    err(`[verify] ${issue.kind}: ${issue.message}`);
  }
  err(`[verify] FAILED — ${result.issues.length} issue(s)`);
  out("FAILED");
  process.exitCode = 1;
}

program.parseAsync(process.argv);
