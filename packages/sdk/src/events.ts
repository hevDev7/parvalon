/**
 * CAE-1 event support (INTEGRATION.md §3):
 *  - typed log decoders that turn a raw `{ topics, data }` log into a typed
 *    event payload, and
 *  - typed watchers built on viem `watchContractEvent` that push decoded
 *    payloads to a callback and return an unsubscribe function.
 *
 * Both share the imported ABIs, so the event names/arg shapes are guaranteed to
 * match the deployed contracts.
 */
import { decodeEventLog } from "viem";
import type {
  Address as ViemAddress,
  Hex as ViemHex,
  Log,
  PublicClient,
} from "viem";
import { registryAbi, distributorAbi } from "./generated/abis.js";
import {
  type ActionAnnouncedEvent,
  type ActionStatusChangedEvent,
  type Address,
  type ClaimedEvent,
  type FundedEvent,
  type Hex,
  type MerkleRootPublishedEvent,
  type UnclaimedSweptEvent,
} from "./types.js";

/** A raw log shape sufficient for `decodeEventLog` (topics + data). */
export interface RawLog {
  readonly topics: [signature?: ViemHex, ...args: ViemHex[]] | ViemHex[];
  readonly data: ViemHex;
}

function asViem(addr: Address): ViemAddress {
  return addr as ViemAddress;
}

// ---------------------------------------------------------------------------
// Decoders — Registry
// ---------------------------------------------------------------------------

/** Decode a `Registry.ActionAnnounced` log into a typed payload. */
export function decodeActionAnnounced(log: RawLog): ActionAnnouncedEvent {
  const { args } = decodeEventLog({
    abi: registryAbi,
    eventName: "ActionAnnounced",
    topics: log.topics as [ViemHex, ...ViemHex[]],
    data: log.data,
  });
  return {
    id: args.id,
    asset: args.asset as Address,
    actionType: args.actionType,
    ratePerShare: args.ratePerShare,
    recordBlock: args.recordBlock,
    payableAt: args.payableAt,
    claimDeadline: args.claimDeadline,
    payoutToken: args.payoutToken as Address,
    metadataURI: args.metadataURI,
  };
}

/** Decode a `Registry.MerkleRootPublished` log into a typed payload. */
export function decodeMerkleRootPublished(log: RawLog): MerkleRootPublishedEvent {
  const { args } = decodeEventLog({
    abi: registryAbi,
    eventName: "MerkleRootPublished",
    topics: log.topics as [ViemHex, ...ViemHex[]],
    data: log.data,
  });
  return {
    id: args.id,
    root: args.root as Hex,
    totalPayout: args.totalPayout,
    holderCount: args.holderCount,
  };
}

/** Decode a `Registry.ActionStatusChanged` log into a typed payload. */
export function decodeActionStatusChanged(log: RawLog): ActionStatusChangedEvent {
  const { args } = decodeEventLog({
    abi: registryAbi,
    eventName: "ActionStatusChanged",
    topics: log.topics as [ViemHex, ...ViemHex[]],
    data: log.data,
  });
  return {
    id: args.id,
    previousStatus: args.previousStatus,
    newStatus: args.newStatus,
  };
}

// ---------------------------------------------------------------------------
// Decoders — Distributor
// ---------------------------------------------------------------------------

/** Decode a `Distributor.Funded` log into a typed payload. */
export function decodeFunded(log: RawLog): FundedEvent {
  const { args } = decodeEventLog({
    abi: distributorAbi,
    eventName: "Funded",
    topics: log.topics as [ViemHex, ...ViemHex[]],
    data: log.data,
  });
  return {
    id: args.id,
    from: args.from as Address,
    amount: args.amount,
    totalFunded: args.totalFunded,
  };
}

/** Decode a `Distributor.Claimed` log into a typed payload. */
export function decodeClaimed(log: RawLog): ClaimedEvent {
  const { args } = decodeEventLog({
    abi: distributorAbi,
    eventName: "Claimed",
    topics: log.topics as [ViemHex, ...ViemHex[]],
    data: log.data,
  });
  return {
    id: args.id,
    index: args.index,
    account: args.account as Address,
    amount: args.amount,
  };
}

/** Decode a `Distributor.UnclaimedSwept` log into a typed payload. */
export function decodeUnclaimedSwept(log: RawLog): UnclaimedSweptEvent {
  const { args } = decodeEventLog({
    abi: distributorAbi,
    eventName: "UnclaimedSwept",
    topics: log.topics as [ViemHex, ...ViemHex[]],
    data: log.data,
  });
  return {
    id: args.id,
    to: args.to as Address,
    amount: args.amount,
  };
}

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------

/** Unsubscribe handle returned by every watcher. */
export type Unwatch = () => void;

/** Called once per decoded event; `log` is the raw viem log for provenance. */
export type EventHandler<T> = (event: T, log: Log) => void;

interface WatchOptions {
  /** Restrict to a single indexed action id (where the event has one). */
  readonly fromBlock?: bigint;
  /** Surface watcher errors (RPC hiccups) instead of swallowing them. */
  readonly onError?: (error: Error) => void;
}

function buildWatchArgs(opts?: WatchOptions) {
  const out: { fromBlock?: bigint; onError?: (error: Error) => void } = {};
  if (opts?.fromBlock !== undefined) out.fromBlock = opts.fromBlock;
  if (opts?.onError !== undefined) out.onError = opts.onError;
  return out;
}

/** Watch `Registry.ActionAnnounced`. Returns an unsubscribe function. */
export function watchActionAnnounced(
  client: PublicClient,
  registry: Address,
  handler: EventHandler<ActionAnnouncedEvent>,
  opts?: WatchOptions,
): Unwatch {
  return client.watchContractEvent({
    address: asViem(registry),
    abi: registryAbi,
    eventName: "ActionAnnounced",
    ...buildWatchArgs(opts),
    onLogs: (logs) => {
      for (const log of logs) handler(decodeActionAnnounced(log), log);
    },
  });
}

/** Watch `Registry.MerkleRootPublished`. */
export function watchMerkleRootPublished(
  client: PublicClient,
  registry: Address,
  handler: EventHandler<MerkleRootPublishedEvent>,
  opts?: WatchOptions,
): Unwatch {
  return client.watchContractEvent({
    address: asViem(registry),
    abi: registryAbi,
    eventName: "MerkleRootPublished",
    ...buildWatchArgs(opts),
    onLogs: (logs) => {
      for (const log of logs) handler(decodeMerkleRootPublished(log), log);
    },
  });
}

/** Watch `Registry.ActionStatusChanged`. */
export function watchActionStatusChanged(
  client: PublicClient,
  registry: Address,
  handler: EventHandler<ActionStatusChangedEvent>,
  opts?: WatchOptions,
): Unwatch {
  return client.watchContractEvent({
    address: asViem(registry),
    abi: registryAbi,
    eventName: "ActionStatusChanged",
    ...buildWatchArgs(opts),
    onLogs: (logs) => {
      for (const log of logs) handler(decodeActionStatusChanged(log), log);
    },
  });
}

/** Watch `Distributor.Funded`. */
export function watchFunded(
  client: PublicClient,
  distributor: Address,
  handler: EventHandler<FundedEvent>,
  opts?: WatchOptions,
): Unwatch {
  return client.watchContractEvent({
    address: asViem(distributor),
    abi: distributorAbi,
    eventName: "Funded",
    ...buildWatchArgs(opts),
    onLogs: (logs) => {
      for (const log of logs) handler(decodeFunded(log), log);
    },
  });
}

/** Watch `Distributor.Claimed`. */
export function watchClaimed(
  client: PublicClient,
  distributor: Address,
  handler: EventHandler<ClaimedEvent>,
  opts?: WatchOptions,
): Unwatch {
  return client.watchContractEvent({
    address: asViem(distributor),
    abi: distributorAbi,
    eventName: "Claimed",
    ...buildWatchArgs(opts),
    onLogs: (logs) => {
      for (const log of logs) handler(decodeClaimed(log), log);
    },
  });
}

/** Watch `Distributor.UnclaimedSwept`. */
export function watchUnclaimedSwept(
  client: PublicClient,
  distributor: Address,
  handler: EventHandler<UnclaimedSweptEvent>,
  opts?: WatchOptions,
): Unwatch {
  return client.watchContractEvent({
    address: asViem(distributor),
    abi: distributorAbi,
    eventName: "UnclaimedSwept",
    ...buildWatchArgs(opts),
    onLogs: (logs) => {
      for (const log of logs) handler(decodeUnclaimedSwept(log), log);
    },
  });
}
