/**
 * The monitor orchestrator.
 *
 * Owns the viem clients and turns the pure {@link checks} into a running
 * service: a polling loop that re-reads the solvency invariant + pause state
 * every interval, and an optional event-subscription mode that reacts to
 * lifecycle / funding / claim / sweep events as they land.
 *
 * Reads use the FROZEN ABIs (`abis/index.ts`, synced into `src/generated`). The
 * `actionView` tuple field order is dictated by INTEGRATION.md §2 and the ABI:
 *   (actionType, status, payableAt, claimDeadline, asset, payoutToken,
 *    merkleRoot, totalPayout)
 */
import {
  createPublicClient,
  http,
  webSocket,
  getAddress,
  type PublicClient,
  type Transport,
  type Log,
} from "viem";

import { registryAbi, distributorAbi, erc20Abi } from "./generated/abi.js";
import {
  type Address,
  type Alert,
  type MonitorConfig,
  ActionStatus,
} from "./types.js";
import {
  type Notifier,
  CompositeNotifier,
} from "./notifier.js";
import {
  type ActionAccounting,
  type TokenBalance,
  ClaimHealthTracker,
  checkSolvency,
  checkStatusChanged,
  checkAnnounced,
  checkRootPublished,
  checkFunded,
  checkSwept,
  checkPauseChange,
} from "./checks.js";

/** A read-only snapshot of the whole protocol, assembled each poll. */
export interface ProtocolSnapshot {
  readonly actionCount: bigint;
  readonly actions: ActionAccounting[];
  readonly balances: TokenBalance[];
  readonly registryPaused: boolean;
  readonly distributorPaused: boolean;
}

/**
 * Builds and drives the monitor. Construct with a resolved {@link MonitorConfig}
 * and a {@link Notifier} (typically a {@link CompositeNotifier}); call
 * {@link pollOnce} for a single sweep, {@link start} for the loop, and
 * {@link subscribe} for live event reactions.
 */
export class Monitor {
  private readonly client: PublicClient;
  private readonly claimHealth: ClaimHealthTracker;
  private readonly seenFundingTxes = new Set<string>();
  private lastRegistryPaused: boolean | undefined;
  private lastDistributorPaused: boolean | undefined;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unwatchers: Array<() => void> = [];

  constructor(
    private readonly config: MonitorConfig,
    private readonly notifier: Notifier,
    private readonly log: (line: string) => void = (l) =>
      process.stderr.write(l + "\n"),
    client?: PublicClient,
  ) {
    this.client =
      client ??
      (createPublicClient({
        transport: pickTransport(config.rpcUrl),
      }) as PublicClient);
    this.claimHealth = new ClaimHealthTracker(config.thresholds);
  }

  /* ----------------------------- reads -------------------------------- */

  /**
   * Read the full protocol snapshot: every action's accounting + the
   * distributor's balance of each distinct payout token + both pause flags.
   * `actionCount()` defines the id range `1..N` (INTEGRATION.md §2).
   */
  async readSnapshot(): Promise<ProtocolSnapshot> {
    const { registry, distributor } = this.config;

    const actionCount = (await this.client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "actionCount",
    })) as bigint;

    const actions: ActionAccounting[] = [];
    for (let id = 1n; id <= actionCount; id++) {
      const view = (await this.client.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "actionView",
        args: [id],
      })) as {
        actionType: number;
        status: number;
        payableAt: bigint;
        claimDeadline: bigint;
        asset: Address;
        payoutToken: Address;
        merkleRoot: `0x${string}`;
        totalPayout: bigint;
      };

      const [funded, claimed] = (await Promise.all([
        this.client.readContract({
          address: distributor,
          abi: distributorAbi,
          functionName: "totalFunded",
          args: [id],
        }),
        this.client.readContract({
          address: distributor,
          abi: distributorAbi,
          functionName: "totalClaimed",
          args: [id],
        }),
      ])) as [bigint, bigint];

      actions.push({
        id,
        status: Number(view.status),
        payoutToken: view.payoutToken.toLowerCase() as Address,
        funded,
        claimed,
      });
    }

    // Distributor balance of each distinct payout token across active actions.
    const tokens = new Set<Address>();
    for (const a of actions) {
      tokens.add(a.payoutToken);
    }
    const balances: TokenBalance[] = [];
    for (const token of tokens) {
      const balance = (await this.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [distributor],
      })) as bigint;
      balances.push({ token, balance });
    }

    const [registryPaused, distributorPaused] = (await Promise.all([
      this.client.readContract({ address: registry, abi: registryAbi, functionName: "paused" }),
      this.client.readContract({ address: distributor, abi: distributorAbi, functionName: "paused" }),
    ])) as [boolean, boolean];

    return { actionCount, actions, balances, registryPaused, distributorPaused };
  }

  /* ----------------------------- poll --------------------------------- */

  /**
   * One full monitoring sweep: read state, run the solvency invariant + pause
   * checks + claim-health window, dispatch alerts. Returns the alerts produced
   * (useful for tests / a `--once` mode). Never throws on a transient RPC
   * error — it emits a `notify` alert and returns.
   */
  async pollOnce(): Promise<Alert[]> {
    let snap: ProtocolSnapshot;
    try {
      snap = await this.readSnapshot();
    } catch (e) {
      const alert: Alert = {
        severity: "notify",
        code: "rpc_error",
        key: "rpc_error",
        title: `Monitor read failed: ${errMsg(e)}`,
        details: { error: errMsg(e) },
        at: new Date().toISOString(),
      };
      await this.notifier.notify(alert);
      return [alert];
    }

    const produced: Alert[] = [];

    // 1) Solvency invariant (the page-worthy one).
    const { results, alerts: solvencyAlerts } = checkSolvency(snap.actions, snap.balances);
    for (const r of results) {
      this.log(
        `[poll] token=${r.token} balance=${r.balance} obligation=${r.obligation} ` +
          `surplus=${r.surplus} ${r.solvent ? "OK" : "INSOLVENT"}`,
      );
    }
    produced.push(...solvencyAlerts);

    // 2) Pause state drift.
    produced.push(
      ...checkPauseChange("registry", this.lastRegistryPaused, snap.registryPaused),
      ...checkPauseChange("distributor", this.lastDistributorPaused, snap.distributorPaused),
    );
    this.lastRegistryPaused = snap.registryPaused;
    this.lastDistributorPaused = snap.distributorPaused;

    // 3) Claim-health window (fed by the event subscription between polls).
    produced.push(...this.claimHealth.evaluate());
    this.claimHealth.reset();

    for (const alert of produced) {
      await this.notifier.notify(alert);
    }
    return produced;
  }

  /* --------------------------- event mode ----------------------------- */

  /**
   * Subscribe to CAE-1 lifecycle + value events and react in real time. Uses
   * viem `watchContractEvent`. Returns an unsubscribe function. Safe to combine
   * with the poll loop — funding/claim observations feed shared state the poll
   * sweep reads (claim-health window, seen-tx set).
   */
  subscribe(): () => void {
    const { registry, distributor } = this.config;
    const t = this.config.thresholds;
    const expectedFunders = this.config.expectedFunders;

    const unRegistry = this.client.watchContractEvent({
      address: registry,
      abi: registryAbi,
      onLogs: (logs) => void this.onRegistryLogs(logs),
      onError: (e) => this.log(`[subscribe] registry watch error: ${errMsg(e)}`),
    });

    const unDistributor = this.client.watchContractEvent({
      address: distributor,
      abi: distributorAbi,
      onLogs: (logs) => void this.onDistributorLogs(logs, t, expectedFunders),
      onError: (e) => this.log(`[subscribe] distributor watch error: ${errMsg(e)}`),
    });

    this.unwatchers.push(unRegistry, unDistributor);
    const unsub = (): void => {
      unRegistry();
      unDistributor();
    };
    return unsub;
  }

  private async onRegistryLogs(logs: Log[]): Promise<void> {
    for (const raw of logs) {
      const log = raw as DecodedLog;
      const eventName = log.eventName;
      const args = log.args ?? {};
      const txHash = (log.transactionHash ?? "0x") as `0x${string}`;
      const alerts: Alert[] = [];

      if (eventName === "ActionStatusChanged") {
        alerts.push(
          ...checkStatusChanged({
            id: args.id as bigint,
            previousStatus: Number(args.previousStatus),
            newStatus: Number(args.newStatus),
            txHash,
          }),
        );
      } else if (eventName === "ActionAnnounced") {
        alerts.push(
          ...checkAnnounced(
            {
              id: args.id as bigint,
              asset: (args.asset as string).toLowerCase() as Address,
              actionType: Number(args.actionType),
              ratePerShare: args.ratePerShare as bigint,
              payoutToken: (args.payoutToken as string).toLowerCase() as Address,
              txHash,
            },
            this.config.thresholds,
          ),
        );
      } else if (eventName === "MerkleRootPublished") {
        alerts.push(
          ...checkRootPublished(
            {
              id: args.id as bigint,
              root: args.root as `0x${string}`,
              totalPayout: args.totalPayout as bigint,
              holderCount: args.holderCount as bigint,
              txHash,
            },
            this.config.thresholds,
          ),
        );
      } else if (eventName === "Paused" || eventName === "Unpaused") {
        // The poll loop owns authoritative pause de-dup; here we surface it live.
        alerts.push(
          ...checkPauseChange(
            "registry",
            !(eventName === "Paused"),
            eventName === "Paused",
          ),
        );
      }

      for (const a of alerts) await this.notifier.notify(a);
    }
  }

  private async onDistributorLogs(
    logs: Log[],
    thresholds: MonitorConfig["thresholds"],
    expectedFunders: readonly Address[],
  ): Promise<void> {
    for (const raw of logs) {
      const log = raw as DecodedLog;
      const eventName = log.eventName;
      const args = log.args ?? {};
      const txHash = (log.transactionHash ?? "0x") as `0x${string}`;
      const alerts: Alert[] = [];

      if (eventName === "Funded") {
        const id = args.id as bigint;
        // Best-effort fetch of the action's totalPayout for the ratio check.
        let totalPayout: bigint | undefined;
        try {
          const view = (await this.client.readContract({
            address: this.config.registry,
            abi: registryAbi,
            functionName: "actionView",
            args: [id],
          })) as { totalPayout: bigint };
          totalPayout = view.totalPayout;
        } catch {
          totalPayout = undefined;
        }
        alerts.push(
          ...checkFunded(
            {
              id,
              from: (args.from as string).toLowerCase() as Address,
              amount: args.amount as bigint,
              totalFunded: args.totalFunded as bigint,
              txHash,
            },
            thresholds,
            {
              ...(totalPayout !== undefined ? { totalPayout } : {}),
              expectedFunders,
              seenTxes: this.seenFundingTxes,
            },
          ),
        );
      } else if (eventName === "Claimed") {
        // A landed `Claimed` event is a successful claim.
        this.claimHealth.recordSuccess();
      } else if (eventName === "UnclaimedSwept") {
        const id = args.id as bigint;
        let totalFunded: bigint | undefined;
        try {
          totalFunded = (await this.client.readContract({
            address: this.config.distributor,
            abi: distributorAbi,
            functionName: "totalFunded",
            args: [id],
          })) as bigint;
        } catch {
          totalFunded = undefined;
        }
        alerts.push(
          ...checkSwept(
            {
              id,
              to: (args.to as string).toLowerCase() as Address,
              amount: args.amount as bigint,
              txHash,
            },
            thresholds,
            totalFunded !== undefined ? { totalFunded } : {},
          ),
        );
      } else if (eventName === "Paused" || eventName === "Unpaused") {
        alerts.push(
          ...checkPauseChange(
            "distributor",
            !(eventName === "Paused"),
            eventName === "Paused",
          ),
        );
      }

      for (const a of alerts) await this.notifier.notify(a);
    }
  }

  /**
   * Record a reverted claim attempt into the rolling window. The poll loop
   * cannot see reverts on its own (a reverted tx emits no `Claimed`), so a
   * relayer / mempool watcher external to this package calls this when it
   * observes a failed `claim` receipt. Exposed for that integration + tests.
   */
  recordClaimRevert(): void {
    this.claimHealth.recordRevert();
  }

  /** Record a successful claim observed out-of-band (parity with the above). */
  recordClaimSuccess(): void {
    this.claimHealth.recordSuccess();
  }

  /* ------------------------------ loop -------------------------------- */

  /**
   * Start the poll loop. Resolves immediately; the loop runs until {@link stop}.
   * Each tick calls {@link pollOnce} then schedules the next after
   * `pollIntervalMs`. Also opens the event subscription so live signals are
   * caught between polls.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.log(
      `[monitor] starting: chainId=${this.config.chainId} ` +
        `registry=${this.config.registry} distributor=${this.config.distributor} ` +
        `pollMs=${this.config.pollIntervalMs}`,
    );

    // Open event subscriptions (best-effort; HTTP transports fall back to
    // polling under the hood via viem).
    try {
      this.subscribe();
    } catch (e) {
      this.log(`[monitor] event subscription unavailable: ${errMsg(e)}`);
    }

    const tick = async (): Promise<void> => {
      if (!this.running) return;
      try {
        await this.pollOnce();
      } catch (e) {
        this.log(`[monitor] poll tick error: ${errMsg(e)}`);
      }
      if (this.running) {
        this.timer = setTimeout(() => void tick(), this.config.pollIntervalMs);
      }
    };
    await tick();
  }

  /** Stop the loop and tear down subscriptions. */
  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    for (const un of this.unwatchers) {
      try {
        un();
      } catch {
        /* ignore */
      }
    }
    this.unwatchers = [];
    this.log("[monitor] stopped");
  }
}

/* -------------------------------------------------------------------------- */
/*  helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Use a WebSocket transport for `ws(s)://` URLs, HTTP otherwise. */
function pickTransport(rpcUrl: string): Transport {
  return rpcUrl.startsWith("ws://") || rpcUrl.startsWith("wss://")
    ? webSocket(rpcUrl)
    : http(rpcUrl);
}

/** Narrow the loosely-typed viem `Log` to the decoded shape we read. */
interface DecodedLog extends Log {
  eventName?: string;
  args?: Record<string, unknown>;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Re-export the address normaliser viem uses, for the CLI/config layer. */
export { getAddress, ActionStatus };
