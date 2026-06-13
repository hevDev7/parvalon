/**
 * On-chain balance reconstruction from ERC20 Transfer logs.
 *
 * CorporaX is a *permissionless overlay*: we do not control the stock token and
 * cannot install transfer hooks, so the only honest way to know who held what at
 * a record block is to replay the token's entire Transfer history up to that
 * block and fold it into a balance map. This module does exactly that, with the
 * production robustness a real RPC requires:
 *
 *   - chunked `eth_getLogs` (provider block-range limits),
 *   - exponential backoff + adaptive chunk halving on rate/range errors,
 *   - progress logging to **stderr** (stdout stays clean for piping),
 *   - BigInt arithmetic throughout (no float drift).
 *
 * The result is a `BalanceProvider` (see types.ts) so tests can inject a fixture
 * balance map instead of standing up a chain.
 */
import {
  createPublicClient,
  http,
  parseAbiItem,
  getAddress,
  type PublicClient,
  type Log,
} from "viem";
import type { Address, BalanceProvider, SnapshotInput } from "./types.js";

/** The ERC20 Transfer event, parsed once. */
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Thrown when the snapshot's `--record-block` is still inside the chain's reorg
 * window — i.e. fewer than `confirmations` blocks separate it from the current
 * head. Logs at/just below an un-finalised record block can be reorged out after
 * we read them, yet the Merkle root is committed immutably and pays the wrong
 * holder set. We refuse rather than commit a root over non-final state.
 *
 * Typed so the CLI can map it to a clear, actionable non-zero exit.
 */
export class FinalityError extends Error {
  override readonly name = "FinalityError";
  constructor(
    /** Current chain head observed via `eth_blockNumber`. */
    readonly head: bigint,
    /** The record block the operator asked to snapshot. */
    readonly recordBlock: bigint,
    /** Required finality depth (confirmations). */
    readonly required: bigint,
    /** Actual depth available: `head - recordBlock` (clamped at 0). */
    readonly actual: bigint,
  ) {
    super(
      `record-block ${recordBlock} is not final: only ${actual} confirmation(s) ` +
        `behind head ${head}, but ${required} required. Refusing to snapshot ` +
        `inside the reorg window — wait for the record block to bury deeper, or ` +
        `lower --confirmations only if you accept reorg risk.`,
    );
  }
}

/** Tunables for the chunked scan. Conservative defaults that "just work". */
export interface ScanOptions {
  /** Max retries per chunk before giving up. */
  readonly maxRetries: number;
  /** Base backoff in ms (doubled each retry, jittered). */
  readonly backoffBaseMs: number;
  /** Smallest chunk we'll shrink to before declaring the provider unusable. */
  readonly minChunk: bigint;
  /**
   * Finality / reorg-buffer depth: the snapshot REFUSES (throws
   * {@link FinalityError}) if `head - recordBlock < confirmations`, where `head`
   * is read from `eth_blockNumber` at scan time.
   *
   * Default `0` preserves legacy behavior — the head is NOT read, no guard runs,
   * but a LOUD reorg-unsafe warning is emitted so the default is visibly (not
   * silently) unsafe. Set a chain-appropriate depth in production (e.g. enough
   * blocks to clear the L2/Orbit reorg window) to make snapshots reorg-safe.
   */
  readonly confirmations: bigint;
  /** Sink for progress lines (defaults to stderr). */
  readonly log: (msg: string) => void;
}

const DEFAULT_OPTIONS: ScanOptions = {
  maxRetries: 6,
  backoffBaseMs: 400,
  minChunk: 1n,
  confirmations: 0n,
  log: (msg) => process.stderr.write(msg + "\n"),
};

/** A minimal log shape we rely on — decoded Transfer args. */
type TransferLog = Log<bigint, number, false, typeof TRANSFER_EVENT, true>;

/**
 * Fold a stream of Transfer logs into a balance map.
 *
 * Rules (INTEGRATION.md / PRD §8.4):
 *   - credit `to`, debit `from`;
 *   - skip the zero address on *both* sides (mints/burns touch supply, not a
 *     holder we can pay);
 *   - addresses are lowercased for stable keys.
 *
 * Exported and pure so it is unit-testable without any network.
 */
export function foldTransfers(
  logs: Iterable<{ from: Address; to: Address; value: bigint }>,
): Map<Address, bigint> {
  const balances = new Map<Address, bigint>();
  const credit = (addr: Address, delta: bigint): void => {
    const key = addr.toLowerCase() as Address;
    if (key === ZERO_ADDRESS) return;
    balances.set(key, (balances.get(key) ?? 0n) + delta);
  };
  for (const { from, to, value } of logs) {
    credit(from, -value);
    credit(to, value);
  }
  return balances;
}

/**
 * Production `BalanceProvider`: scans `eth_getLogs` for Transfer events from the
 * token deploy block through the record block (inclusive) and folds them.
 */
export class RpcBalanceProvider implements BalanceProvider {
  private readonly options: ScanOptions;

  constructor(
    private readonly client: PublicClient,
    options: Partial<ScanOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Convenience constructor from a plain RPC URL. */
  static fromRpcUrl(
    rpcUrl: string,
    options: Partial<ScanOptions> = {},
  ): RpcBalanceProvider {
    const client = createPublicClient({ transport: http(rpcUrl) });
    return new RpcBalanceProvider(client, options);
  }

  async balancesAt(input: SnapshotInput): Promise<Map<Address, bigint>> {
    const { asset, deployBlock, recordBlock } = input;
    if (recordBlock < deployBlock) {
      throw new Error(
        `record-block (${recordBlock}) is below deploy-block (${deployBlock})`,
      );
    }

    // Finality / reorg-buffer guard. With confirmations > 0 we read the current
    // head and REFUSE to snapshot a record block still inside the reorg window;
    // committing a Merkle root over logs that can still be reorged out would pay
    // the wrong holder set. With the default 0 we don't read the head at all
    // (legacy behavior) but emit a LOUD warning so the default is visibly unsafe.
    await this.assertFinal(recordBlock);

    const transfers = await this.scanTransfers(
      getAddress(asset),
      deployBlock,
      recordBlock,
      input.chunkSize,
    );
    this.options.log(
      `[snapshot] folded ${transfers.length} Transfer logs into balances`,
    );
    return foldTransfers(transfers);
  }

  /**
   * Reorg-safety gate. When `confirmations > 0`, read the chain head and throw
   * {@link FinalityError} if the record block is not yet buried under at least
   * that many confirmations. When `confirmations === 0` we skip the head read
   * entirely (deterministic, no-network legacy path) but warn LOUDLY so the
   * unsafe default is never silent.
   */
  private async assertFinal(recordBlock: bigint): Promise<void> {
    const required = this.options.confirmations;
    if (required <= 0n) {
      this.options.log(
        "[snapshot] WARNING: --confirmations is 0 — NO finality/reorg buffer. " +
          "Logs at or below the record block may still be reorged out, yet the " +
          "Merkle root is committed immutably. Set --confirmations to your " +
          "chain's reorg depth to make this snapshot reorg-safe.",
      );
      return;
    }
    const head = await this.client.getBlockNumber();
    const actual = head > recordBlock ? head - recordBlock : 0n;
    if (actual < required) {
      throw new FinalityError(head, recordBlock, required, actual);
    }
    this.options.log(
      `[snapshot] finality OK: record block ${recordBlock} is ${actual} ` +
        `confirmation(s) behind head ${head} (>= ${required} required)`,
    );
  }

  /**
   * Walk the block range in chunks, collecting decoded Transfer args. Chunk size
   * adapts down on provider errors and is restored cautiously on success.
   */
  private async scanTransfers(
    asset: Address,
    fromBlock: bigint,
    toBlock: bigint,
    initialChunk: bigint,
  ): Promise<Array<{ from: Address; to: Address; value: bigint }>> {
    const out: Array<{ from: Address; to: Address; value: bigint }> = [];
    const total = toBlock - fromBlock + 1n;
    let cursor = fromBlock;
    let chunk = initialChunk > 0n ? initialChunk : 1n;

    while (cursor <= toBlock) {
      const end = min(cursor + chunk - 1n, toBlock);
      const logs = await this.getLogsWithRetry(asset, cursor, end, () => {
        // On hard failure the retry loop halves the chunk; reflect that here so
        // the *next* iteration also benefits from the smaller window.
        chunk = max(this.options.minChunk, chunk / 2n);
      });

      for (const log of logs) {
        const args = log.args;
        // `strict: true` decoding guarantees these are present, but guard anyway.
        if (args.from === undefined || args.to === undefined || args.value === undefined) {
          continue;
        }
        out.push({
          from: args.from.toLowerCase() as Address,
          to: args.to.toLowerCase() as Address,
          value: args.value,
        });
      }

      const scanned = end - fromBlock + 1n;
      this.options.log(
        `[snapshot] blocks ${cursor}–${end} ` +
          `(${pct(scanned, total)}%) · ${out.length} transfers so far`,
      );

      cursor = end + 1n;
      // Gently grow the window back toward the requested size after a clean read.
      if (chunk < initialChunk) chunk = min(initialChunk, chunk * 2n);
    }
    return out;
  }

  /**
   * `getLogs` for one window with exponential backoff. On the final failure we
   * rethrow with context so the CLI can print a clear, actionable error.
   */
  private async getLogsWithRetry(
    asset: Address,
    fromBlock: bigint,
    toBlock: bigint,
    onShrink: () => void,
  ): Promise<TransferLog[]> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return (await this.client.getLogs({
          address: asset,
          event: TRANSFER_EVENT,
          fromBlock,
          toBlock,
          strict: true,
        })) as TransferLog[];
      } catch (err) {
        attempt += 1;
        if (attempt > this.options.maxRetries) {
          throw new Error(
            `eth_getLogs failed for blocks ${fromBlock}–${toBlock} after ` +
              `${this.options.maxRetries} retries: ${describe(err)}`,
          );
        }
        // Range-too-large style errors benefit from a smaller window next time.
        if (looksLikeRangeError(err)) onShrink();
        const delay = jitter(
          this.options.backoffBaseMs * 2 ** (attempt - 1),
        );
        this.options.log(
          `[snapshot] retry ${attempt}/${this.options.maxRetries} for ` +
            `blocks ${fromBlock}–${toBlock} in ${delay}ms (${describe(err)})`,
        );
        await sleep(delay);
      }
    }
  }
}

/* ----------------------------- small helpers ------------------------------ */

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
function pct(part: bigint, whole: bigint): string {
  if (whole === 0n) return "100.0";
  return ((Number(part) / Number(whole)) * 100).toFixed(1);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}
function describe(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0] ?? err.message;
  return String(err);
}
/** Heuristic: does this error read like a provider range/limit complaint? */
function looksLikeRangeError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("range") ||
    msg.includes("limit") ||
    msg.includes("too many") ||
    msg.includes("10000") ||
    msg.includes("query returned more than") ||
    msg.includes("block range")
  );
}
