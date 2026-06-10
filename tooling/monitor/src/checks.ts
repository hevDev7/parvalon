/**
 * Monitoring checks — pure functions over on-chain state and decoded events.
 *
 * Every signal in PRODUCTION-READINESS.md §4 lives here as a small, deterministic
 * function that takes a plain data snapshot and returns zero or more {@link Alert}s.
 * Keeping them pure (no RPC, no I/O) is what makes the invariant logic unit-
 * testable without a live chain — `monitor.ts` does the reading, these decide.
 *
 * Severity policy (PRODUCTION-READINESS.md §4 table):
 *   - Solvency drift (balance < Σ funded−claimed) ............ page
 *   - Pause state change ..................................... notify
 *   - Anomalous announcement / large funding / unexpected
 *     funder / claim-revert spike / large-or-early sweep ..... notify
 *   - Normal lifecycle transitions / normal sweeps ........... info
 */
import {
  type Address,
  type Alert,
  type Thresholds,
  ActionStatus,
  isActiveForSolvency,
  statusName,
  actionTypeName,
  makeAlert,
} from "./types.js";

/* -------------------------------------------------------------------------- */
/*  Solvency invariant                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Per-action accounting snapshot, as read from the {@link DividendDistributor}
 * and {@link CorporateActionRegistry}. `funded`/`claimed` are the contract's
 * cumulative `totalFunded(id)` / `totalClaimed(id)`; `payoutToken` is the ERC20
 * the action settles in; `status` is the registry status code.
 */
export interface ActionAccounting {
  readonly id: bigint;
  readonly status: number;
  readonly payoutToken: Address;
  readonly funded: bigint;
  readonly claimed: bigint;
}

/** The distributor's on-chain ERC20 balance for one payout token. */
export interface TokenBalance {
  readonly token: Address;
  readonly balance: bigint;
}

/** Result of the solvency check for one payout token (for dashboards/tests). */
export interface SolvencyResult {
  readonly token: Address;
  /** Σ over active actions of `funded - claimed` — the custodial obligation. */
  readonly obligation: bigint;
  /** Distributor's actual ERC20 balance of `token`. */
  readonly balance: bigint;
  /** `balance - obligation`. Negative = insolvent (a shortfall). */
  readonly surplus: bigint;
  readonly solvent: boolean;
}

/**
 * The core P0-6 invariant. The distributor pools funds across actions, so the
 * obligation is summed **per payout token** over actions whose remainder is
 * still custodied ({@link isActiveForSolvency}). The contract caps funding at
 * `totalPayout` and only ever pays leaf amounts, so in a healthy system the
 * balance is `>=` the obligation (it can exceed it via stray transfers / dust
 * from a prior finalized action — those are surplus, not a breach).
 *
 * A shortfall (`balance < obligation`) means the distributor cannot honour all
 * outstanding claims — funds left without a matching claim, a buggy token, or a
 * compromised distributor. That is a **page**.
 *
 * @returns one SolvencyResult per token, plus a `page` Alert for each insolvent
 *          token. De-dup key is per-token so a persistent breach pages once per
 *          cooldown window.
 */
export function checkSolvency(
  actions: readonly ActionAccounting[],
  balances: readonly TokenBalance[],
): { results: SolvencyResult[]; alerts: Alert[] } {
  // Σ (funded - claimed) per token over active actions.
  const obligationByToken = new Map<Address, bigint>();
  for (const a of actions) {
    if (!isActiveForSolvency(a.status)) continue;
    const remaining = a.funded - a.claimed;
    // Per-action remaining should never be negative (claimed <= funded by the
    // Overfunded cap + leaf-sum binding). If it is, that itself is corruption.
    const key = a.payoutToken.toLowerCase() as Address;
    obligationByToken.set(key, (obligationByToken.get(key) ?? 0n) + remaining);
  }

  const balanceByToken = new Map<Address, bigint>();
  for (const b of balances) {
    balanceByToken.set(b.token.toLowerCase() as Address, b.balance);
  }

  const results: SolvencyResult[] = [];
  const alerts: Alert[] = [];

  // Union of tokens that have either an obligation or a tracked balance.
  const tokens = new Set<Address>([
    ...obligationByToken.keys(),
    ...balanceByToken.keys(),
  ]);

  for (const token of tokens) {
    const obligation = obligationByToken.get(token) ?? 0n;
    const balance = balanceByToken.get(token) ?? 0n;
    const surplus = balance - obligation;
    const solvent = surplus >= 0n;
    results.push({ token, obligation, balance, surplus, solvent });

    if (!solvent) {
      alerts.push(
        makeAlert(
          "page",
          "solvency_drift",
          `solvency:${token}`,
          `SOLVENCY VIOLATION: distributor balance ${balance} < obligation ${obligation} for payout token ${token}`,
          {
            token,
            balance,
            obligation,
            shortfall: obligation - balance,
            activeActions: actions
              .filter(
                (a) =>
                  isActiveForSolvency(a.status) &&
                  (a.payoutToken.toLowerCase() as Address) === token,
              )
              .map((a) => ({
                id: a.id,
                status: statusName(a.status),
                funded: a.funded,
                claimed: a.claimed,
                remaining: a.funded - a.claimed,
              })),
          },
        ),
      );
    }
  }

  return { results, alerts };
}

/* -------------------------------------------------------------------------- */
/*  Lifecycle: status transitions                                              */
/* -------------------------------------------------------------------------- */

/** Decoded `ActionStatusChanged(id, previousStatus, newStatus)`. */
export interface StatusChangedEvent {
  readonly id: bigint;
  readonly previousStatus: number;
  readonly newStatus: number;
  readonly txHash: Hex;
}

type Hex = `0x${string}`;

/**
 * The allowed status DAG (INTEGRATION.md §2, derived from the contract guards):
 *   ANNOUNCED      -> ROOT_PUBLISHED | CANCELLED
 *   ROOT_PUBLISHED -> CLAIMABLE      | CANCELLED
 *   CLAIMABLE      -> FINALIZED
 * Anything else is an illegal transition and is itself an anomaly (notify).
 */
const ALLOWED_TRANSITIONS: Record<number, readonly number[]> = {
  [ActionStatus.ANNOUNCED]: [ActionStatus.ROOT_PUBLISHED, ActionStatus.CANCELLED],
  [ActionStatus.ROOT_PUBLISHED]: [ActionStatus.CLAIMABLE, ActionStatus.CANCELLED],
  [ActionStatus.CLAIMABLE]: [ActionStatus.FINALIZED],
  [ActionStatus.FINALIZED]: [],
  [ActionStatus.CANCELLED]: [],
};

/** Emit an alert for a status transition; flag illegal ones at `notify`. */
export function checkStatusChanged(ev: StatusChangedEvent): Alert[] {
  const allowed = ALLOWED_TRANSITIONS[ev.previousStatus] ?? [];
  const legal = allowed.includes(ev.newStatus);
  const from = statusName(ev.previousStatus);
  const to = statusName(ev.newStatus);

  if (!legal) {
    return [
      makeAlert(
        "notify",
        "illegal_status_transition",
        `status:${ev.id}:${ev.txHash}`,
        `Action ${ev.id}: ILLEGAL status transition ${from} -> ${to}`,
        { id: ev.id, from, to, txHash: ev.txHash },
      ),
    ];
  }
  return [
    makeAlert(
      "info",
      "status_changed",
      `status:${ev.id}:${ev.txHash}`,
      `Action ${ev.id}: ${from} -> ${to}`,
      { id: ev.id, from, to, txHash: ev.txHash },
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/*  Lifecycle: anomalous announcements                                         */
/* -------------------------------------------------------------------------- */

/** Decoded `ActionAnnounced(...)` — the fields we screen. */
export interface AnnouncedEvent {
  readonly id: bigint;
  readonly asset: Address;
  readonly actionType: number;
  readonly ratePerShare: bigint;
  readonly payoutToken: Address;
  readonly txHash: Hex;
}

/**
 * Screen an announcement for implausible parameters. `ratePerShare` above the
 * configured ceiling, or an implied `totalPayout` (rate is per 1e18 shares, so
 * we can only bound the *rate* here without a holder count) over the ceiling, is
 * flagged. An optional `expectedAssets` allowlist flags an unknown asset.
 *
 * @param expectedAssets lowercase allowlist; empty = skip the asset check.
 */
export function checkAnnounced(
  ev: AnnouncedEvent,
  thresholds: Thresholds,
  expectedAssets: readonly Address[] = [],
): Alert[] {
  const alerts: Alert[] = [];
  const baseDetails = {
    id: ev.id,
    asset: ev.asset,
    actionType: actionTypeName(ev.actionType),
    ratePerShare: ev.ratePerShare,
    payoutToken: ev.payoutToken,
    txHash: ev.txHash,
  };

  if (ev.ratePerShare > thresholds.maxRatePerShare) {
    alerts.push(
      makeAlert(
        "notify",
        "implausible_rate",
        `announce-rate:${ev.id}`,
        `Action ${ev.id}: implausible ratePerShare ${ev.ratePerShare} (> ${thresholds.maxRatePerShare})`,
        { ...baseDetails, maxRatePerShare: thresholds.maxRatePerShare },
      ),
    );
  }

  if (expectedAssets.length > 0) {
    const asset = ev.asset.toLowerCase() as Address;
    if (!expectedAssets.includes(asset)) {
      alerts.push(
        makeAlert(
          "notify",
          "unknown_asset",
          `announce-asset:${ev.id}`,
          `Action ${ev.id}: announced for unexpected asset ${ev.asset}`,
          baseDetails,
        ),
      );
    }
  }

  if (alerts.length === 0) {
    alerts.push(
      makeAlert(
        "info",
        "action_announced",
        `announce:${ev.id}`,
        `Action ${ev.id} announced: ${actionTypeName(ev.actionType)} on ${ev.asset}`,
        baseDetails,
      ),
    );
  }
  return alerts;
}

/** Decoded `MerkleRootPublished(id, root, totalPayout, holderCount)`. */
export interface RootPublishedEvent {
  readonly id: bigint;
  readonly root: Hex;
  readonly totalPayout: bigint;
  readonly holderCount: bigint;
  readonly txHash: Hex;
}

/** Screen a published root: implausible `totalPayout`, or zero holders. */
export function checkRootPublished(
  ev: RootPublishedEvent,
  thresholds: Thresholds,
): Alert[] {
  const alerts: Alert[] = [];
  if (ev.totalPayout > thresholds.maxTotalPayout) {
    alerts.push(
      makeAlert(
        "notify",
        "implausible_total_payout",
        `root-payout:${ev.id}`,
        `Action ${ev.id}: implausible totalPayout ${ev.totalPayout} (> ${thresholds.maxTotalPayout})`,
        { id: ev.id, totalPayout: ev.totalPayout, maxTotalPayout: thresholds.maxTotalPayout, txHash: ev.txHash },
      ),
    );
  }
  if (ev.holderCount === 0n) {
    alerts.push(
      makeAlert(
        "notify",
        "zero_holder_root",
        `root-holders:${ev.id}`,
        `Action ${ev.id}: published a root with 0 holders`,
        { id: ev.id, root: ev.root, txHash: ev.txHash },
      ),
    );
  }
  if (alerts.length === 0) {
    alerts.push(
      makeAlert(
        "info",
        "root_published",
        `root:${ev.id}`,
        `Action ${ev.id}: root published, totalPayout=${ev.totalPayout}, holders=${ev.holderCount}`,
        { id: ev.id, root: ev.root, totalPayout: ev.totalPayout, holderCount: ev.holderCount, txHash: ev.txHash },
      ),
    );
  }
  return alerts;
}

/* -------------------------------------------------------------------------- */
/*  Funding anomalies                                                          */
/* -------------------------------------------------------------------------- */

/** Decoded `Funded(id, from, amount, totalFunded)`. */
export interface FundedEvent {
  readonly id: bigint;
  readonly from: Address;
  readonly amount: bigint;
  readonly totalFunded: bigint;
  readonly txHash: Hex;
}

/**
 * Screen a funding event for: an unexpected funder (not the action's known
 * issuer / not on the allowlist), an over-large single fund relative to the
 * action's `totalPayout`, and a duplicate (same tx already seen this run).
 *
 * @param totalPayout the action's funding target (0/undefined = skip ratio check)
 * @param expectedFunders lowercase allowlist; empty = skip the funder check
 * @param seenTxes        set of `${id}:${txHash}` already processed (mutated)
 */
export function checkFunded(
  ev: FundedEvent,
  thresholds: Thresholds,
  opts: {
    totalPayout?: bigint;
    expectedFunders?: readonly Address[];
    seenTxes?: Set<string>;
  } = {},
): Alert[] {
  const alerts: Alert[] = [];
  const txKey = `${ev.id}:${ev.txHash}`;
  const details = {
    id: ev.id,
    from: ev.from,
    amount: ev.amount,
    totalFunded: ev.totalFunded,
    txHash: ev.txHash,
  };

  // Duplicate detection (same id+tx replayed — e.g. a reorg re-delivery).
  if (opts.seenTxes) {
    if (opts.seenTxes.has(txKey)) {
      alerts.push(
        makeAlert(
          "notify",
          "duplicate_funding",
          `funded-dup:${txKey}`,
          `Action ${ev.id}: duplicate Funded event for tx ${ev.txHash}`,
          details,
        ),
      );
    } else {
      opts.seenTxes.add(txKey);
    }
  }

  // Unexpected funder.
  const funders = opts.expectedFunders ?? [];
  if (funders.length > 0) {
    const from = ev.from.toLowerCase() as Address;
    if (!funders.includes(from)) {
      alerts.push(
        makeAlert(
          "notify",
          "unexpected_funder",
          `funded-src:${txKey}`,
          `Action ${ev.id}: funded from unexpected source ${ev.from}`,
          details,
        ),
      );
    }
  }

  // Over-large single fund.
  if (opts.totalPayout && opts.totalPayout > 0n) {
    // amount / totalPayout >= ratio  <=>  amount * 1 >= ratio * totalPayout.
    // Do it in the rational domain to avoid bigint truncation surprises.
    const ratio = Number(ev.amount) / Number(opts.totalPayout);
    if (ratio >= thresholds.largeFundingRatio) {
      alerts.push(
        makeAlert(
          "notify",
          "large_funding",
          `funded-large:${txKey}`,
          `Action ${ev.id}: large single funding ${ev.amount} (${(ratio * 100).toFixed(1)}% of totalPayout ${opts.totalPayout})`,
          { ...details, totalPayout: opts.totalPayout, ratio },
        ),
      );
    }
  }

  if (alerts.length === 0) {
    alerts.push(
      makeAlert(
        "info",
        "funded",
        `funded:${txKey}`,
        `Action ${ev.id}: funded ${ev.amount} (cumulative ${ev.totalFunded})`,
        details,
      ),
    );
  }
  return alerts;
}

/* -------------------------------------------------------------------------- */
/*  Claim health (revert-rate spike)                                           */
/* -------------------------------------------------------------------------- */

/**
 * A rolling window of claim attempts vs reverts. `monitor.ts` feeds it observed
 * `claim` transactions (success via `Claimed` events; reverts via failed
 * receipts / mempool drops) and asks for an alert when the revert rate spikes.
 *
 * Pure and self-contained so it can be unit-tested with synthetic counts.
 */
export class ClaimHealthTracker {
  private attempts = 0;
  private reverts = 0;
  private alertedThisWindow = false;

  constructor(private readonly thresholds: Thresholds) {}

  /** Record one successful claim. */
  recordSuccess(): void {
    this.attempts += 1;
  }

  /** Record one reverted/failed claim attempt. */
  recordRevert(): void {
    this.attempts += 1;
    this.reverts += 1;
  }

  /** Current revert rate (0..1); 0 when no attempts. */
  get revertRate(): number {
    return this.attempts === 0 ? 0 : this.reverts / this.attempts;
  }

  /**
   * Returns a `notify` alert if the window has enough attempts and the revert
   * rate exceeds the threshold — once per window, until {@link reset}. `monitor`
   * resets the window each poll so a sustained spike re-alerts each interval
   * (subject to the notifier cooldown), not every event.
   */
  evaluate(): Alert[] {
    if (this.attempts < this.thresholds.minClaimAttemptsForRate) return [];
    if (this.revertRate <= this.thresholds.maxClaimRevertRate) return [];
    if (this.alertedThisWindow) return [];
    this.alertedThisWindow = true;
    return [
      makeAlert(
        "notify",
        "claim_revert_spike",
        `claim-reverts:${windowStamp()}`,
        `Claim revert spike: ${this.reverts}/${this.attempts} reverted (${(this.revertRate * 100).toFixed(1)}% > ${(this.thresholds.maxClaimRevertRate * 100).toFixed(0)}%)`,
        { attempts: this.attempts, reverts: this.reverts, revertRate: this.revertRate },
      ),
    ];
  }

  /** Start a fresh window. */
  reset(): void {
    this.attempts = 0;
    this.reverts = 0;
    this.alertedThisWindow = false;
  }
}

function windowStamp(): string {
  // Coarse minute bucket so cooldown de-dup naturally coalesces a sustained spike.
  return String(Math.floor(Date.now() / 60_000));
}

/* -------------------------------------------------------------------------- */
/*  Sweep anomalies                                                            */
/* -------------------------------------------------------------------------- */

/** Decoded `UnclaimedSwept(id, to, amount)`. */
export interface SweptEvent {
  readonly id: bigint;
  readonly to: Address;
  readonly amount: bigint;
  readonly txHash: Hex;
}

/**
 * Screen a sweep: a large remainder (most holders never claimed) relative to
 * `totalFunded`, or an "early" sweep (only possible via a deadline=0/clock-skew
 * anomaly, since the contract gates on `claimDeadline`). `nowSecs`/`deadline`
 * are optional; when both are present we apply the early-window check.
 */
export function checkSwept(
  ev: SweptEvent,
  thresholds: Thresholds,
  opts: { totalFunded?: bigint; deadline?: number; nowSecs?: number } = {},
): Alert[] {
  const alerts: Alert[] = [];
  const details = { id: ev.id, to: ev.to, amount: ev.amount, txHash: ev.txHash };

  if (opts.totalFunded && opts.totalFunded > 0n) {
    const ratio = Number(ev.amount) / Number(opts.totalFunded);
    if (ratio >= thresholds.largeSweepRemainderRatio) {
      alerts.push(
        makeAlert(
          "notify",
          "large_sweep_remainder",
          `sweep-large:${ev.id}`,
          `Action ${ev.id}: large unclaimed remainder swept ${ev.amount} (${(ratio * 100).toFixed(1)}% of funded ${opts.totalFunded})`,
          { ...details, totalFunded: opts.totalFunded, ratio },
        ),
      );
    }
  }

  if (
    thresholds.earlySweepWindowSecs > 0 &&
    opts.deadline !== undefined &&
    opts.nowSecs !== undefined &&
    opts.deadline - opts.nowSecs > thresholds.earlySweepWindowSecs
  ) {
    alerts.push(
      makeAlert(
        "notify",
        "early_sweep",
        `sweep-early:${ev.id}`,
        `Action ${ev.id}: sweep ${opts.deadline - opts.nowSecs}s before claimDeadline (window ${thresholds.earlySweepWindowSecs}s)`,
        { ...details, deadline: opts.deadline, nowSecs: opts.nowSecs },
      ),
    );
  }

  if (alerts.length === 0) {
    alerts.push(
      makeAlert(
        "info",
        "swept",
        `sweep:${ev.id}`,
        `Action ${ev.id}: swept ${ev.amount} unclaimed to ${ev.to}`,
        details,
      ),
    );
  }
  return alerts;
}

/* -------------------------------------------------------------------------- */
/*  Pause state                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Compare a freshly-read pause flag against the last known value for a contract
 * and emit a `notify` alert on any change. `contract` is a label
 * ("registry"/"distributor"). Returns the alert (or none) — the caller persists
 * the new value as the next "previous".
 */
export function checkPauseChange(
  contract: string,
  previous: boolean | undefined,
  current: boolean,
): Alert[] {
  if (previous === undefined || previous === current) return [];
  return [
    makeAlert(
      "notify",
      "pause_changed",
      `pause:${contract}`,
      `${contract} ${current ? "PAUSED" : "UNPAUSED"}`,
      { contract, paused: current },
    ),
  ];
}
