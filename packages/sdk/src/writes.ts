/**
 * Write helpers — submit transactions via a viem `WalletClient`.
 *
 * Each helper builds calldata with the pure encoders in `./encode.ts`, then
 * sends it through `walletClient.writeContract`, returning the transaction hash.
 * The wallet's configured `account` and `chain` are used; callers may override
 * the account per-call.
 *
 * `fundWithApproval` is the one composite: ERC-20 `approve` then
 * `Distributor.fund` (two transactions — `fund` pulls via `transferFrom`).
 */
import type {
  Account,
  Address as ViemAddress,
  Hash,
  PublicClient,
  WalletClient,
} from "viem";
import {
  encodeAnnounceAction,
  encodeApprove,
  encodeCancelAction,
  encodeClaim,
  encodeFund,
  encodePublishRoot,
  encodeSweepUnclaimed,
  claimArgsFromEligible,
  type AnnounceActionArgs,
  type ClaimArgs,
  type PublishRootArgs,
} from "./encode.js";
import type { Address, EligibleClaim } from "./types.js";

/** Optional per-call overrides; defaults come from the WalletClient. */
export interface TxOptions {
  /** Override the signing account (else the wallet's configured account). */
  readonly account?: Account | Address;
}

function asViem(addr: Address): ViemAddress {
  return addr as ViemAddress;
}

/**
 * Resolve the account viem should sign with: explicit override → wallet default.
 * Throws early with a clear message if neither is set (viem's own error is
 * deep inside writeContract).
 */
function resolveAccount(
  wallet: WalletClient,
  opts?: TxOptions,
): Account | ViemAddress {
  const acct = opts?.account ?? wallet.account;
  if (!acct) {
    throw new Error(
      "no account: pass { account } or construct the WalletClient with an account",
    );
  }
  return typeof acct === "string" ? (acct as ViemAddress) : acct;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** `Registry.announceAction(...)` → new action id is in the tx receipt's event. */
export async function announceAction(
  wallet: WalletClient,
  registry: Address,
  args: AnnounceActionArgs,
  opts?: TxOptions,
): Promise<Hash> {
  const e = encodeAnnounceAction(args);
  return wallet.writeContract({
    address: asViem(registry),
    abi: e.abi,
    functionName: e.functionName,
    args: e.args,
    account: resolveAccount(wallet, opts),
    chain: wallet.chain,
  });
}

/** `Registry.publishRoot(id, root, totalPayout, holderCount)`. */
export async function publishRoot(
  wallet: WalletClient,
  registry: Address,
  args: PublishRootArgs,
  opts?: TxOptions,
): Promise<Hash> {
  const e = encodePublishRoot(args);
  return wallet.writeContract({
    address: asViem(registry),
    abi: e.abi,
    functionName: e.functionName,
    args: e.args,
    account: resolveAccount(wallet, opts),
    chain: wallet.chain,
  });
}

/** `Registry.cancelAction(id)`. */
export async function cancelAction(
  wallet: WalletClient,
  registry: Address,
  id: bigint,
  opts?: TxOptions,
): Promise<Hash> {
  const e = encodeCancelAction(id);
  return wallet.writeContract({
    address: asViem(registry),
    abi: e.abi,
    functionName: e.functionName,
    args: e.args,
    account: resolveAccount(wallet, opts),
    chain: wallet.chain,
  });
}

// ---------------------------------------------------------------------------
// Distributor
// ---------------------------------------------------------------------------

/** `Distributor.fund(id, amount)` — assumes allowance is already in place. */
export async function fund(
  wallet: WalletClient,
  distributor: Address,
  id: bigint,
  amount: bigint,
  opts?: TxOptions,
): Promise<Hash> {
  const e = encodeFund(id, amount);
  return wallet.writeContract({
    address: asViem(distributor),
    abi: e.abi,
    functionName: e.functionName,
    args: e.args,
    account: resolveAccount(wallet, opts),
    chain: wallet.chain,
  });
}

/** ERC-20 `approve(distributor, amount)` on the payout token. */
export async function approvePayoutToken(
  wallet: WalletClient,
  payoutToken: Address,
  distributor: Address,
  amount: bigint,
  opts?: TxOptions,
): Promise<Hash> {
  const e = encodeApprove(distributor, amount);
  return wallet.writeContract({
    address: asViem(payoutToken),
    abi: e.abi,
    functionName: e.functionName,
    args: e.args,
    account: resolveAccount(wallet, opts),
    chain: wallet.chain,
  });
}

/**
 * Approve-then-fund convenience. Two transactions:
 *   1. `payoutToken.approve(distributor, amount)`
 *   2. `distributor.fund(id, amount)`
 *
 * If a `publicClient` is supplied, step 2 waits for step 1's receipt first
 * (required on chains where `fund`'s `transferFrom` must see the allowance).
 * Returns both hashes.
 */
export async function fundWithApproval(
  wallet: WalletClient,
  params: {
    readonly distributor: Address;
    readonly payoutToken: Address;
    readonly id: bigint;
    readonly amount: bigint;
    /** Optional — used to await the approve receipt before funding. */
    readonly publicClient?: PublicClient;
  },
  opts?: TxOptions,
): Promise<{ approveHash: Hash; fundHash: Hash }> {
  const approveHash = await approvePayoutToken(
    wallet,
    params.payoutToken,
    params.distributor,
    params.amount,
    opts,
  );
  if (params.publicClient) {
    await params.publicClient.waitForTransactionReceipt({ hash: approveHash });
  }
  const fundHash = await fund(
    wallet,
    params.distributor,
    params.id,
    params.amount,
    opts,
  );
  return { approveHash, fundHash };
}

/**
 * `Distributor.claim(id, index, account, amount, proof)` — claim-on-behalf.
 * Anyone may submit; funds always go to `account`.
 */
export async function claim(
  wallet: WalletClient,
  distributor: Address,
  args: ClaimArgs,
  opts?: TxOptions,
): Promise<Hash> {
  const e = encodeClaim(args);
  return wallet.writeContract({
    address: asViem(distributor),
    abi: e.abi,
    functionName: e.functionName,
    args: e.args,
    account: resolveAccount(wallet, opts),
    chain: wallet.chain,
  });
}

/**
 * Submit a claim directly from an {@link EligibleClaim} resolved from a
 * proofs.json (`eligibleClaimFor(proofs, account)`). The funds go to
 * `claim.account` regardless of who signs — claim-on-behalf is supported.
 */
export async function claimFromEligible(
  wallet: WalletClient,
  distributor: Address,
  eligible: EligibleClaim,
  opts?: TxOptions,
): Promise<Hash> {
  return claim(wallet, distributor, claimArgsFromEligible(eligible), opts);
}

/** `Distributor.sweepUnclaimed(id)` — issuer, after the claim deadline. */
export async function sweepUnclaimed(
  wallet: WalletClient,
  distributor: Address,
  id: bigint,
  opts?: TxOptions,
): Promise<Hash> {
  const e = encodeSweepUnclaimed(id);
  return wallet.writeContract({
    address: asViem(distributor),
    abi: e.abi,
    functionName: e.functionName,
    args: e.args,
    account: resolveAccount(wallet, opts),
    chain: wallet.chain,
  });
}
