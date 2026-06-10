/**
 * Read helpers — typed `eth_call` wrappers over the Registry & Distributor.
 *
 * Every function takes a viem `PublicClient` and the relevant contract address.
 * The ABIs are imported (never hand-written) from the generated module, which is
 * a verbatim copy of the repo-root `abis/*.json` (see scripts/sync-abis.ts).
 *
 * Tuple/struct results from `getAction`/`actionView` are mapped into the typed
 * {@link CorporateAction} / {@link ActionView} domain objects so callers never
 * touch positional tuples.
 */
import type { Address as ViemAddress, PublicClient } from "viem";
import { registryAbi, distributorAbi } from "./generated/abis.js";
import {
  type Address,
  type ActionView,
  type CorporateAction,
  type Hex,
} from "./types.js";

/** Cast our branded `Address` to viem's `Address` (identical shape). */
function asViem(addr: Address): ViemAddress {
  return addr as ViemAddress;
}

/**
 * `Registry.getAction(id)` → full {@link CorporateAction} (incl. metadataURI).
 * Reverts with `ActionNotFound` on the chain if `id` is out of range.
 */
export async function getAction(
  client: PublicClient,
  registry: Address,
  id: bigint,
): Promise<CorporateAction> {
  const a = await client.readContract({
    address: asViem(registry),
    abi: registryAbi,
    functionName: "getAction",
    args: [id],
  });
  return {
    id: a.id,
    asset: a.asset as Address,
    actionType: a.actionType,
    ratePerShare: a.ratePerShare,
    recordBlock: a.recordBlock,
    payableAt: a.payableAt,
    claimDeadline: a.claimDeadline,
    payoutToken: a.payoutToken as Address,
    merkleRoot: a.merkleRoot as Hex,
    totalPayout: a.totalPayout,
    status: a.status,
    metadataURI: a.metadataURI,
  };
}

/**
 * `Registry.actionView(id)` → gas-lean {@link ActionView} (no metadataURI).
 */
export async function actionView(
  client: PublicClient,
  registry: Address,
  id: bigint,
): Promise<ActionView> {
  const v = await client.readContract({
    address: asViem(registry),
    abi: registryAbi,
    functionName: "actionView",
    args: [id],
  });
  return {
    actionType: v.actionType,
    status: v.status,
    payableAt: v.payableAt,
    claimDeadline: v.claimDeadline,
    asset: v.asset as Address,
    payoutToken: v.payoutToken as Address,
    merkleRoot: v.merkleRoot as Hex,
    totalPayout: v.totalPayout,
  };
}

/** `Registry.actionCount()` → number of actions (ids run `1..count`). */
export async function actionCount(
  client: PublicClient,
  registry: Address,
): Promise<bigint> {
  return client.readContract({
    address: asViem(registry),
    abi: registryAbi,
    functionName: "actionCount",
  });
}

/**
 * Convenience: fetch every action by looping `1..actionCount()` and calling
 * `getAction`. Returns them in ascending id order. For large registries prefer
 * an indexer / multicall; this is the simple, correct baseline.
 */
export async function listActions(
  client: PublicClient,
  registry: Address,
): Promise<CorporateAction[]> {
  const count = await actionCount(client, registry);
  const out: CorporateAction[] = [];
  for (let id = 1n; id <= count; id++) {
    out.push(await getAction(client, registry, id));
  }
  return out;
}

/** `Registry.assetIssuer(asset)` → the issuer authorised for `asset`. */
export async function assetIssuer(
  client: PublicClient,
  registry: Address,
  asset: Address,
): Promise<Address> {
  const issuer = await client.readContract({
    address: asViem(registry),
    abi: registryAbi,
    functionName: "assetIssuer",
    args: [asViem(asset)],
  });
  return issuer as Address;
}

/** `Registry.actionSource()` → the active oracle/action source address. */
export async function actionSource(
  client: PublicClient,
  registry: Address,
): Promise<Address> {
  const src = await client.readContract({
    address: asViem(registry),
    abi: registryAbi,
    functionName: "actionSource",
  });
  return src as Address;
}

/** `Distributor.isClaimed(id, index)` → whether the bitmap slot is consumed. */
export async function isClaimed(
  client: PublicClient,
  distributor: Address,
  id: bigint,
  index: bigint,
): Promise<boolean> {
  return client.readContract({
    address: asViem(distributor),
    abi: distributorAbi,
    functionName: "isClaimed",
    args: [id, index],
  });
}

/** `Distributor.totalFunded(id)` → wei funded so far for the action. */
export async function totalFunded(
  client: PublicClient,
  distributor: Address,
  id: bigint,
): Promise<bigint> {
  return client.readContract({
    address: asViem(distributor),
    abi: distributorAbi,
    functionName: "totalFunded",
    args: [id],
  });
}

/** `Distributor.totalClaimed(id)` → wei claimed so far for the action. */
export async function totalClaimed(
  client: PublicClient,
  distributor: Address,
  id: bigint,
): Promise<bigint> {
  return client.readContract({
    address: asViem(distributor),
    abi: distributorAbi,
    functionName: "totalClaimed",
    args: [id],
  });
}
