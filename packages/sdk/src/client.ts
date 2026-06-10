/**
 * `CorporaXClient` — the high-level façade that wires reads, writes, event
 * watchers and the claim path together from a single config object.
 *
 * Construct it with `{ chain, addresses, publicClient, walletClient? }`. Reads
 * and watchers need only the `publicClient`; writes require a `walletClient`
 * (a clear error is thrown if you call a write without one). The standalone
 * functions in `./reads`, `./writes`, `./events` remain available for callers
 * who prefer a functional style or want to avoid carrying the class.
 */
import type { Chain, Hash, PublicClient, WalletClient } from "viem";
import * as reads from "./reads.js";
import * as writes from "./writes.js";
import * as events from "./events.js";
import { eligibleClaimFor } from "./proofs.js";
import type {
  ActionAnnouncedEvent,
  ActionStatusChangedEvent,
  ActionView,
  Address,
  ClaimedEvent,
  CorporateAction,
  CorporaXAddresses,
  EligibleClaim,
  FundedEvent,
  MerkleRootPublishedEvent,
  ProofsFile,
  UnclaimedSweptEvent,
} from "./types.js";
import type {
  AnnounceActionArgs,
  ClaimArgs,
  PublishRootArgs,
} from "./encode.js";
import type { TxOptions } from "./writes.js";
import type { EventHandler, Unwatch } from "./events.js";

/** Constructor config for {@link CorporaXClient}. */
export interface CorporaXClientConfig {
  /** The viem chain (e.g. from `./chains`). Informational / convenience. */
  readonly chain: Chain;
  /** Registry + Distributor addresses (e.g. from a deployments/<id>.json). */
  readonly addresses: CorporaXAddresses;
  /** Required — backs all reads and event watchers. */
  readonly publicClient: PublicClient;
  /** Optional — required only for write helpers. */
  readonly walletClient?: WalletClient;
}

export class CorporaXClient {
  readonly chain: Chain;
  readonly addresses: CorporaXAddresses;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient | undefined;

  constructor(config: CorporaXClientConfig) {
    this.chain = config.chain;
    this.addresses = config.addresses;
    this.publicClient = config.publicClient;
    this.walletClient = config.walletClient;
  }

  /** Throw a clear error if a write is attempted without a wallet. */
  private requireWallet(): WalletClient {
    if (!this.walletClient) {
      throw new Error(
        "CorporaXClient: this operation needs a walletClient — construct with one",
      );
    }
    return this.walletClient;
  }

  // -----------------------------------------------------------------------
  // Reads
  // -----------------------------------------------------------------------

  getAction(id: bigint): Promise<CorporateAction> {
    return reads.getAction(this.publicClient, this.addresses.registry, id);
  }

  actionView(id: bigint): Promise<ActionView> {
    return reads.actionView(this.publicClient, this.addresses.registry, id);
  }

  actionCount(): Promise<bigint> {
    return reads.actionCount(this.publicClient, this.addresses.registry);
  }

  listActions(): Promise<CorporateAction[]> {
    return reads.listActions(this.publicClient, this.addresses.registry);
  }

  assetIssuer(asset: Address): Promise<Address> {
    return reads.assetIssuer(this.publicClient, this.addresses.registry, asset);
  }

  actionSource(): Promise<Address> {
    return reads.actionSource(this.publicClient, this.addresses.registry);
  }

  isClaimed(id: bigint, index: bigint): Promise<boolean> {
    return reads.isClaimed(this.publicClient, this.addresses.distributor, id, index);
  }

  totalFunded(id: bigint): Promise<bigint> {
    return reads.totalFunded(this.publicClient, this.addresses.distributor, id);
  }

  totalClaimed(id: bigint): Promise<bigint> {
    return reads.totalClaimed(this.publicClient, this.addresses.distributor, id);
  }

  // -----------------------------------------------------------------------
  // Writes
  // -----------------------------------------------------------------------

  announceAction(args: AnnounceActionArgs, opts?: TxOptions): Promise<Hash> {
    return writes.announceAction(
      this.requireWallet(),
      this.addresses.registry,
      args,
      opts,
    );
  }

  publishRoot(args: PublishRootArgs, opts?: TxOptions): Promise<Hash> {
    return writes.publishRoot(
      this.requireWallet(),
      this.addresses.registry,
      args,
      opts,
    );
  }

  cancelAction(id: bigint, opts?: TxOptions): Promise<Hash> {
    return writes.cancelAction(
      this.requireWallet(),
      this.addresses.registry,
      id,
      opts,
    );
  }

  fund(id: bigint, amount: bigint, opts?: TxOptions): Promise<Hash> {
    return writes.fund(
      this.requireWallet(),
      this.addresses.distributor,
      id,
      amount,
      opts,
    );
  }

  /** Approve the payout token, then fund. See {@link writes.fundWithApproval}. */
  fundWithApproval(
    params: { readonly payoutToken: Address; readonly id: bigint; readonly amount: bigint; readonly awaitApproval?: boolean },
    opts?: TxOptions,
  ): Promise<{ approveHash: Hash; fundHash: Hash }> {
    return writes.fundWithApproval(
      this.requireWallet(),
      {
        distributor: this.addresses.distributor,
        payoutToken: params.payoutToken,
        id: params.id,
        amount: params.amount,
        // Default: wait for the approve receipt before funding for correctness.
        ...(params.awaitApproval === false ? {} : { publicClient: this.publicClient }),
      },
      opts,
    );
  }

  claim(args: ClaimArgs, opts?: TxOptions): Promise<Hash> {
    return writes.claim(this.requireWallet(), this.addresses.distributor, args, opts);
  }

  /** Submit a claim from an {@link EligibleClaim} (e.g. via {@link claimForAccount}). */
  claimFromEligible(eligible: EligibleClaim, opts?: TxOptions): Promise<Hash> {
    return writes.claimFromEligible(
      this.requireWallet(),
      this.addresses.distributor,
      eligible,
      opts,
    );
  }

  /**
   * One-call claim: resolve `account`'s entry from a parsed proofs.json and
   * submit it. Funds go to `account` (claim-on-behalf). Throws if the account
   * is not eligible in the supplied proofs.
   */
  claimForAccount(
    proofs: ProofsFile,
    account: Address,
    opts?: TxOptions,
  ): Promise<Hash> {
    const eligible = eligibleClaimFor(proofs, account);
    if (!eligible) {
      throw new Error(`account ${account} is not eligible in proofs for action ${proofs.actionId}`);
    }
    return this.claimFromEligible(eligible, opts);
  }

  sweepUnclaimed(id: bigint, opts?: TxOptions): Promise<Hash> {
    return writes.sweepUnclaimed(
      this.requireWallet(),
      this.addresses.distributor,
      id,
      opts,
    );
  }

  // -----------------------------------------------------------------------
  // Event watchers — each returns an unsubscribe function
  // -----------------------------------------------------------------------

  watchActionAnnounced(handler: EventHandler<ActionAnnouncedEvent>): Unwatch {
    return events.watchActionAnnounced(this.publicClient, this.addresses.registry, handler);
  }

  watchMerkleRootPublished(handler: EventHandler<MerkleRootPublishedEvent>): Unwatch {
    return events.watchMerkleRootPublished(this.publicClient, this.addresses.registry, handler);
  }

  watchActionStatusChanged(handler: EventHandler<ActionStatusChangedEvent>): Unwatch {
    return events.watchActionStatusChanged(this.publicClient, this.addresses.registry, handler);
  }

  watchFunded(handler: EventHandler<FundedEvent>): Unwatch {
    return events.watchFunded(this.publicClient, this.addresses.distributor, handler);
  }

  watchClaimed(handler: EventHandler<ClaimedEvent>): Unwatch {
    return events.watchClaimed(this.publicClient, this.addresses.distributor, handler);
  }

  watchUnclaimedSwept(handler: EventHandler<UnclaimedSweptEvent>): Unwatch {
    return events.watchUnclaimedSwept(this.publicClient, this.addresses.distributor, handler);
  }
}
