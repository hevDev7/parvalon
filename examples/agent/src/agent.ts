/**
 * Chain plumbing: resolve config, subscribe to CAE-1 `ActionAnnounced` via viem
 * `watchContractEvent`, decode each log, run the pure decision core, and hand
 * the decision to a sink (the CLI prints it).
 *
 * This module does the I/O; src/strategy.ts does the thinking. Keeping them
 * apart is what lets the decision logic be unit-tested with a synthetic event
 * and no live chain.
 */
import {
  createPublicClient,
  http,
  getAddress,
  type Address,
  type PublicClient,
} from "viem";
import { registryAbi } from "./abi.js";
import { decideOnAnnouncement } from "./strategy.js";
import type { ActionAnnouncedEvent, Holdings, StrategyDecision } from "./types.js";

/** Resolved runtime configuration for the agent. */
export interface AgentConfig {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly registry: Address;
  /** The agent's book, keyed by lowercase asset address. */
  readonly holdings: Holdings;
}

/** Minimal shape of a deployments/<chainId>.json file (INTEGRATION.md §6). */
export interface DeploymentsFile {
  readonly chainId: number;
  readonly registry: string;
  readonly distributor: string;
  readonly [k: string]: unknown;
}

/**
 * Resolve config from env first, then a deployments file as fallback.
 *
 * Env (canonical names, INTEGRATION.md §9):
 *   - NEXT_PUBLIC_RPC_URL or RPC_URL          — JSON-RPC endpoint
 *   - NEXT_PUBLIC_REGISTRY_ADDRESS            — registry address
 *   - NEXT_PUBLIC_CHAIN_ID                    — chain id (defaults to file/31337)
 *   - AGENT_HOLDINGS                          — JSON map {assetAddr: unitsString}
 *
 * `deployments` (optional) supplies registry/chainId when env omits them.
 */
export function resolveConfig(
  env: Record<string, string | undefined>,
  deployments?: DeploymentsFile,
): AgentConfig {
  const rpcUrl = env.NEXT_PUBLIC_RPC_URL ?? env.RPC_URL ?? "http://127.0.0.1:8545";

  const registryRaw =
    env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? deployments?.registry;
  if (!registryRaw) {
    throw new Error(
      "No registry address: set NEXT_PUBLIC_REGISTRY_ADDRESS or pass a deployments file.",
    );
  }
  const registry = getAddress(registryRaw);

  const chainId = env.NEXT_PUBLIC_CHAIN_ID
    ? Number(env.NEXT_PUBLIC_CHAIN_ID)
    : (deployments?.chainId ?? 31337);

  const holdings = parseHoldings(env.AGENT_HOLDINGS);

  return { chainId, rpcUrl, registry, holdings };
}

/** Parse the AGENT_HOLDINGS env JSON into a lowercase-keyed bigint map. */
export function parseHoldings(raw: string | undefined): Holdings {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, string | number>;
  const out: Record<string, bigint> = {};
  for (const [asset, units] of Object.entries(parsed)) {
    out[getAddress(asset).toLowerCase()] = BigInt(units);
  }
  return out;
}

/** Build a viem public client for the agent's chain. */
export function makeClient(config: AgentConfig): PublicClient {
  return createPublicClient({ transport: http(config.rpcUrl) });
}

/**
 * Map a viem-decoded `ActionAnnounced` log's `args` to our `ActionAnnouncedEvent`.
 * Exported so tests can exercise the same widening the watcher uses.
 */
export function toAnnouncedEvent(args: {
  id?: bigint | undefined;
  asset?: Address | undefined;
  actionType?: number | undefined;
  ratePerShare?: bigint | undefined;
  recordBlock?: bigint | undefined;
  payableAt?: bigint | undefined;
  claimDeadline?: bigint | undefined;
  payoutToken?: Address | undefined;
  metadataURI?: string | undefined;
}): ActionAnnouncedEvent {
  return {
    id: req(args.id, "id"),
    asset: getAddress(req(args.asset, "asset")),
    actionType: Number(req(args.actionType, "actionType")),
    ratePerShare: req(args.ratePerShare, "ratePerShare"),
    recordBlock: BigInt(req(args.recordBlock, "recordBlock")),
    payableAt: BigInt(req(args.payableAt, "payableAt")),
    claimDeadline: BigInt(req(args.claimDeadline, "claimDeadline")),
    payoutToken: getAddress(req(args.payoutToken, "payoutToken")),
    metadataURI: req(args.metadataURI, "metadataURI"),
  };
}

function req<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`ActionAnnounced log missing field: ${name}`);
  }
  return value;
}

/**
 * Subscribe to `ActionAnnounced` on the registry and invoke `onDecision` for
 * each. Returns the viem `unwatch` function. Live-chain path; not exercised by
 * the unit test (which calls the pure core directly).
 */
export function watchAnnouncements(
  client: PublicClient,
  config: AgentConfig,
  onDecision: (decision: StrategyDecision, event: ActionAnnouncedEvent) => void,
): () => void {
  return client.watchContractEvent({
    address: config.registry,
    abi: registryAbi,
    eventName: "ActionAnnounced",
    onLogs: (logs) => {
      for (const log of logs) {
        const event = toAnnouncedEvent(log.args);
        const decision = decideOnAnnouncement(event, config.holdings);
        onDecision(decision, event);
      }
    },
    onError: (err) => {
      // Surface transport errors; a production agent would add backoff/retry.
      console.error("[agent] watch error:", err.message);
    },
  });
}
