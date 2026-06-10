/**
 * Pure calldata encoders for every write entrypoint.
 *
 * Each function returns `{ address, abi, functionName, args }` — a viem
 * `writeContract` request without a signer. Splitting "what to call" from "who
 * sends it" makes the calldata independently unit-testable (no live chain, no
 * wallet) and lets the write helpers and the client share one source of truth.
 *
 * Args mirror the contract signatures exactly (INTEGRATION.md §2).
 */
import { encodeFunctionData } from "viem";
import type { Address as ViemAddress, Hex as ViemHex } from "viem";
import { registryAbi, distributorAbi, erc20Abi } from "./generated/abis.js";
import {
  type ActionType,
  type Address,
  type EligibleClaim,
  type Hex,
} from "./types.js";

function asViem(addr: Address): ViemAddress {
  return addr as ViemAddress;
}

// ---------------------------------------------------------------------------
// Registry writes
// ---------------------------------------------------------------------------

/** Strongly-typed args for `Registry.announceAction`. */
export interface AnnounceActionArgs {
  readonly asset: Address;
  readonly actionType: ActionType;
  readonly ratePerShare: bigint;
  readonly recordBlock: bigint;
  readonly payableAt: bigint;
  readonly claimDeadline: bigint;
  readonly payoutToken: Address;
  readonly metadataURI: string;
}

export function encodeAnnounceAction(args: AnnounceActionArgs) {
  return {
    abi: registryAbi,
    functionName: "announceAction",
    args: [
      asViem(args.asset),
      args.actionType,
      args.ratePerShare,
      args.recordBlock,
      args.payableAt,
      args.claimDeadline,
      asViem(args.payoutToken),
      args.metadataURI,
    ],
  } as const;
}

/** Strongly-typed args for `Registry.publishRoot`. */
export interface PublishRootArgs {
  readonly id: bigint;
  readonly root: Hex;
  readonly totalPayout: bigint;
  readonly holderCount: bigint;
}

export function encodePublishRoot(args: PublishRootArgs) {
  return {
    abi: registryAbi,
    functionName: "publishRoot",
    args: [args.id, args.root as ViemHex, args.totalPayout, args.holderCount],
  } as const;
}

export function encodeCancelAction(id: bigint) {
  return {
    abi: registryAbi,
    functionName: "cancelAction",
    args: [id],
  } as const;
}

// ---------------------------------------------------------------------------
// Distributor writes
// ---------------------------------------------------------------------------

export function encodeFund(id: bigint, amount: bigint) {
  return {
    abi: distributorAbi,
    functionName: "fund",
    args: [id, amount],
  } as const;
}

/** Strongly-typed args for `Distributor.claim` (claim-on-behalf — pays `account`). */
export interface ClaimArgs {
  readonly id: bigint;
  readonly index: bigint;
  readonly account: Address;
  readonly amount: bigint;
  readonly proof: readonly Hex[];
}

export function encodeClaim(args: ClaimArgs) {
  return {
    abi: distributorAbi,
    functionName: "claim",
    args: [
      args.id,
      args.index,
      asViem(args.account),
      args.amount,
      args.proof as readonly ViemHex[],
    ],
  } as const;
}

/** Build the {@link ClaimArgs} for an {@link EligibleClaim} from proofs.json. */
export function claimArgsFromEligible(claim: EligibleClaim): ClaimArgs {
  return {
    id: claim.actionId,
    index: claim.index,
    account: claim.account,
    amount: claim.amount,
    proof: claim.proof,
  };
}

export function encodeSweepUnclaimed(id: bigint) {
  return {
    abi: distributorAbi,
    functionName: "sweepUnclaimed",
    args: [id],
  } as const;
}

// ---------------------------------------------------------------------------
// ERC-20 (for the approve+fund convenience)
// ---------------------------------------------------------------------------

export function encodeApprove(spender: Address, amount: bigint) {
  return {
    abi: erc20Abi,
    functionName: "approve",
    args: [asViem(spender), amount],
  } as const;
}

// ---------------------------------------------------------------------------
// Raw 0x calldata (for relayers / gas estimation outside viem's writeContract)
// ---------------------------------------------------------------------------

/** `Registry.announceAction` ABI-encoded calldata (`0x…`). */
export function announceActionCalldata(args: AnnounceActionArgs): Hex {
  const e = encodeAnnounceAction(args);
  return encodeFunctionData({
    abi: e.abi,
    functionName: e.functionName,
    args: e.args,
  });
}

/** `Registry.publishRoot` ABI-encoded calldata (`0x…`). */
export function publishRootCalldata(args: PublishRootArgs): Hex {
  const e = encodePublishRoot(args);
  return encodeFunctionData({
    abi: e.abi,
    functionName: e.functionName,
    args: e.args,
  });
}

/** `Distributor.claim` ABI-encoded calldata (`0x…`). */
export function claimCalldata(args: ClaimArgs): Hex {
  const e = encodeClaim(args);
  return encodeFunctionData({
    abi: e.abi,
    functionName: e.functionName,
    args: e.args,
  });
}

/** `Distributor.fund` ABI-encoded calldata (`0x…`). */
export function fundCalldata(id: bigint, amount: bigint): Hex {
  const e = encodeFund(id, amount);
  return encodeFunctionData({
    abi: e.abi,
    functionName: e.functionName,
    args: e.args,
  });
}
