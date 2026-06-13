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

import { MAX_BPS } from "./types.js";
import type {
  Address,
  ActionMetadata,
  ProofsFile,
  SnapshotInput,
} from "./types.js";
import { RpcBalanceProvider } from "./balances.js";
import { generateSnapshot, serializeProofs } from "./snapshot.js";
import { verifyProofs } from "./verify.js";
import { resolvePinner, NoPinnerConfiguredError } from "./pin.js";

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

/** Parse a comma-separated list of addresses (e.g. `--exclude 0xa,0xb`). */
function parseAddressListArg(value: string): Address[] {
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const out: Address[] = [];
  for (const p of parts) {
    if (!isAddress(p)) {
      throw new InvalidArgumentError(`--exclude contains an invalid address: ${p}`);
    }
    out.push(getAddress(p).toLowerCase() as Address);
  }
  return out;
}

/** Parse a basis-points integer in [0, 10000]. */
function parseBpsArg(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_BPS) {
    throw new InvalidArgumentError(
      `--withholding-bps must be an integer in [0, ${MAX_BPS}], got: ${value}`,
    );
  }
  return n;
}

/**
 * Read an exclusion file: a JSON array of address strings (the documented
 * shape), or an object with an `addresses: string[]` field for convenience.
 * Returns lowercase, validated addresses.
 */
function readExcludeFile(path: string): Address[] {
  const abs = resolve(path);
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch (e) {
    throw new Error(
      `could not read --exclude-file ${abs}: ${e instanceof Error ? e.message : e}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `--exclude-file ${abs} is not valid JSON: ${e instanceof Error ? e.message : e}`,
    );
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { addresses?: unknown }).addresses)
      ? (parsed as { addresses: unknown[] }).addresses
      : null;
  if (!list) {
    throw new Error(
      `--exclude-file ${abs} must be a JSON array of addresses (or { "addresses": [...] })`,
    );
  }
  const out: Address[] = [];
  for (const item of list) {
    if (typeof item !== "string" || !isAddress(item)) {
      throw new Error(`--exclude-file ${abs} contains an invalid address: ${String(item)}`);
    }
    out.push(getAddress(item).toLowerCase() as Address);
  }
  return out;
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
  // Finality / reorg buffer. Default 0 = no head read, no guard (legacy), but the
  // run prints a LOUD reorg-unsafe warning. Set this to your chain's reorg depth
  // to REFUSE snapshotting a record block still inside the reorg window.
  .option(
    "--confirmations <n>",
    "finality depth: refuse if head-recordBlock < n (default: 0 = unsafe, warns)",
    parseBigIntArg,
  )
  .option(
    "--finality <n>",
    "alias for --confirmations",
    parseBigIntArg,
  )
  .option("--payout-token <addr>", "payout token address (written into the artifact)", parseAddressArg)
  .option("--chain-id <n>", "chain id to record (defaults to the RPC's reported id)", parseBigIntArg)
  // P1-3 exclusions
  .option(
    "--exclude <addrs>",
    "comma-separated addresses to drop from the eligible set (AMM pools, bridges, escrows)",
    parseAddressListArg,
  )
  .option(
    "--exclude-file <path>",
    "path to a JSON array of addresses to exclude (merged with --exclude)",
  )
  // P1-5 withholding
  .option(
    "--withholding-bps <n>",
    "withholding tax in basis points (0..10000); net leaf amount = gross*(10000-bps)/10000",
    parseBpsArg,
  )
  // P1-5 metadata (mechanism-only; legal/KYC is the issuer's)
  .option("--jurisdiction <code>", "issuer tax jurisdiction recorded in metadata (e.g. US)")
  .option("--ex-date <date>", "ex-dividend date (ISO-8601 YYYY-MM-DD) recorded in metadata")
  .option("--record-date <date>", "record date (ISO-8601 YYYY-MM-DD) recorded in metadata")
  .option("--pay-date <date>", "pay date (ISO-8601 YYYY-MM-DD) recorded in metadata")
  .option("--tax-class <class>", "tax classification recorded in metadata (e.g. ordinary)")
  // P1-2 IPFS pinning
  .option(
    "--pin-ipfs",
    "pin the artifact to IPFS (uses $IPFS_API_URL/$IPFS_API_KEY; no-op + warning if unset)",
  )
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
  /** Finality depth (reorg buffer). undefined → 0 (unsafe, warns). */
  confirmations?: bigint;
  /** Alias for --confirmations. */
  finality?: bigint;
  payoutToken?: Address;
  chainId?: bigint;
  // P1-3 exclusions
  exclude?: Address[];
  excludeFile?: string;
  // P1-5 withholding + metadata
  withholdingBps?: number;
  jurisdiction?: string;
  exDate?: string;
  recordDate?: string;
  payDate?: string;
  taxClass?: string;
  // P1-2 pinning
  pinIpfs?: boolean;
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

  // Finality / reorg buffer. --confirmations and its --finality alias both feed
  // the same guard; default 0 keeps legacy behavior but emits a loud warning.
  const confirmations = opts.confirmations ?? opts.finality ?? 0n;

  // P1-3 — merge --exclude and --exclude-file into one deduped list (the
  // snapshot layer normalises/sorts; this just unions the sources).
  const excludeFromFile = opts.excludeFile ? readExcludeFile(opts.excludeFile) : [];
  const exclude = [...(opts.exclude ?? []), ...excludeFromFile];

  // P1-5 — assemble action metadata from flags + the withholding rate.
  const metadata = buildMetadata(opts);

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
    ...(exclude.length > 0 ? { exclude } : {}),
    ...(opts.withholdingBps !== undefined ? { withholdingBps: opts.withholdingBps } : {}),
    ...(metadata ? { metadata } : {}),
  };

  err(
    `[snapshot] asset=${input.asset} blocks=${input.deployBlock}..${input.recordBlock} ` +
      `rate=${input.ratePerShare} actionId=${input.actionId} chainId=${chainId}`,
  );
  if (exclude.length > 0) {
    err(`[snapshot] excluding ${exclude.length} address(es) before indexing`);
  }
  if (opts.withholdingBps !== undefined) {
    err(`[snapshot] withholding ${opts.withholdingBps} bps (net = gross*(10000-bps)/10000)`);
  }

  const provider = new RpcBalanceProvider(client, { log: err, confirmations });
  let artifact = await generateSnapshot(input, provider);

  // Serialise once. If pinning is requested, content-address the EXACT bytes we
  // write to disk, then stamp the CID back in and re-serialise so disk and CID
  // agree on the bytes-without-CID provenance.
  const baseJson = serializeProofs(artifact);

  // P1-2 — optional IPFS pin. We pin the artifact *as written* (without proofsCid,
  // since a CID cannot reference a document that contains itself), then record
  // the returned CID alongside in the on-disk file for consumer convenience.
  if (opts.pinIpfs) {
    const pinner = resolvePinner({ log: err });
    try {
      const { cid } = await pinner.pin(
        new TextEncoder().encode(baseJson),
        `proofs-${chainId}-${input.actionId}.json`,
      );
      artifact = { ...artifact, proofsCid: cid };
      err(`[snapshot] pinned to IPFS: ${cid}`);
    } catch (e) {
      if (e instanceof NoPinnerConfiguredError) {
        // Warning already emitted by NoopPinner; proceed without a CID.
      } else {
        err(`[snapshot] WARNING: IPFS pin failed, continuing without proofsCid: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const finalJson = artifact.proofsCid ? serializeProofs(artifact) : baseJson;

  const outPath = resolve(opts.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, finalJson, "utf8");

  err(
    `[snapshot] holders=${artifact.holderCount} ` +
      `totalPayout=${artifact.totalPayout} root=${artifact.merkleRoot}`,
  );
  if (artifact.totalGross !== undefined) {
    err(`[snapshot] totalGross=${artifact.totalGross} withholdingBps=${artifact.withholdingBps}`);
  }
  if (artifact.proofsCid) {
    err(`[snapshot] proofsCid=${artifact.proofsCid}`);
  }
  err(`[snapshot] wrote ${outPath}`);
  // stdout: just the path, so callers can capture it cleanly.
  out(outPath);
}

/** Build the {@link ActionMetadata} block from CLI flags (omitting empty ones). */
function buildMetadata(opts: SnapshotOpts): ActionMetadata | undefined {
  const m: {
    -readonly [K in keyof ActionMetadata]: ActionMetadata[K];
  } = {};
  if (opts.jurisdiction) m.jurisdiction = opts.jurisdiction;
  if (opts.exDate) m.exDate = opts.exDate;
  if (opts.recordDate) m.recordDate = opts.recordDate;
  if (opts.payDate) m.payDate = opts.payDate;
  if (opts.taxClass) m.taxClass = opts.taxClass;
  // withholdingBps is folded in by the snapshot layer.
  return Object.keys(m).length > 0 ? m : undefined;
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
