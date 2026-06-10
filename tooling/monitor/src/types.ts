/**
 * Shared types for `@corporax/monitor`.
 *
 * These describe the protocol's on-chain shapes (as read via the FROZEN ABIs in
 * `abis/index.ts`) plus the monitor's own alert/severity model. Anything that
 * crosses the contract boundary (enum values, struct field order, event names)
 * is dictated by `docs/INTEGRATION.md` and must not drift.
 */

/** A `0x`-prefixed hex address. */
export type Address = `0x${string}`;

/** A `0x`-prefixed 32-byte hash. */
export type Hex = `0x${string}`;

/* -------------------------------------------------------------------------- */
/*  Protocol enums (INTEGRATION.md §2) — kept as plain const objects so they   */
/*  type-check under `verbatimModuleSyntax` without enum emit.                  */
/* -------------------------------------------------------------------------- */

/** `ANNOUNCED=0 ROOT_PUBLISHED=1 CLAIMABLE=2 FINALIZED=3 CANCELLED=4`. */
export const ActionStatus = {
  ANNOUNCED: 0,
  ROOT_PUBLISHED: 1,
  CLAIMABLE: 2,
  FINALIZED: 3,
  CANCELLED: 4,
} as const;
export type ActionStatus = (typeof ActionStatus)[keyof typeof ActionStatus];

/** `CASH_DIVIDEND=0 STOCK_SPLIT=1 STOCK_DIVIDEND=2`. */
export const ActionType = {
  CASH_DIVIDEND: 0,
  STOCK_SPLIT: 1,
  STOCK_DIVIDEND: 2,
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

/** Human label for a status code (for alert text); falls back to the number. */
export function statusName(s: number): string {
  return STATUS_NAMES[s] ?? `STATUS_${s}`;
}
const STATUS_NAMES: Record<number, string> = {
  0: "ANNOUNCED",
  1: "ROOT_PUBLISHED",
  2: "CLAIMABLE",
  3: "FINALIZED",
  4: "CANCELLED",
};

/** Human label for an action-type code. */
export function actionTypeName(t: number): string {
  return ACTION_TYPE_NAMES[t] ?? `TYPE_${t}`;
}
const ACTION_TYPE_NAMES: Record<number, string> = {
  0: "CASH_DIVIDEND",
  1: "STOCK_SPLIT",
  2: "STOCK_DIVIDEND",
};

/**
 * Statuses whose per-action `funded - claimed` is still custodied by the
 * distributor and therefore counts toward the solvency obligation. After
 * FINALIZED (sweep) the remainder has been transferred out; CANCELLED never
 * funds. ANNOUNCED has no published root yet (can't fund), but including it is
 * harmless since `funded == 0` there.
 */
export function isActiveForSolvency(status: number): boolean {
  return (
    status === ActionStatus.ANNOUNCED ||
    status === ActionStatus.ROOT_PUBLISHED ||
    status === ActionStatus.CLAIMABLE
  );
}

/* -------------------------------------------------------------------------- */
/*  Alert model                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Severity tiers, ordered. `page` wakes someone up (solvency violation); `notify`
 * is an operator-visible signal (pause toggled, large funding); `info` is
 * informational (status transitions, normal sweeps).
 */
export type Severity = "page" | "notify" | "info";

/** Numeric ordering so sinks can threshold (e.g. webhook only on >= notify). */
export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  notify: 1,
  page: 2,
};

/**
 * A single alert. `key` is a stable de-dup identity for the condition (e.g.
 * `solvency:<token>` or `funded:<id>:<txHash>`); the monitor suppresses repeat
 * alerts with the same key within a cooldown window so a persistent invariant
 * breach pages once, not every poll.
 */
export interface Alert {
  readonly severity: Severity;
  /** Short machine code, e.g. `solvency_drift`, `pause_changed`. */
  readonly code: string;
  /** Stable de-dup key for this specific condition occurrence. */
  readonly key: string;
  /** One-line human summary. */
  readonly title: string;
  /** Structured context (addresses, amounts as decimal strings, ids). */
  readonly details: Record<string, unknown>;
  /** ISO-8601 timestamp the alert was produced. */
  readonly at: string;
}

/** Helper to build an {@link Alert} with a generated timestamp. */
export function makeAlert(
  severity: Severity,
  code: string,
  key: string,
  title: string,
  details: Record<string, unknown> = {},
): Alert {
  return { severity, code, key, title, details, at: new Date().toISOString() };
}

/* -------------------------------------------------------------------------- */
/*  Config                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Anomaly thresholds. All amounts are decimal-string-free here: they are wei
 * (bigint) where they bound on-chain values, or plain numbers for rates/counts.
 * Defaults live in {@link DEFAULT_THRESHOLDS}.
 */
export interface Thresholds {
  /**
   * `ratePerShare` upper bound (wei per 1e18 shares) above which an announcement
   * is flagged implausible. Default 1e24 (= 1,000,000 payout-units per share).
   */
  readonly maxRatePerShare: bigint;
  /**
   * `totalPayout` upper bound (wei) above which a published root / announcement
   * is flagged implausible. Default 1e30.
   */
  readonly maxTotalPayout: bigint;
  /**
   * A single `Funded` event amount at or above this share of the action's
   * `totalPayout` is flagged "over-large". Default 1.0 (i.e. a single fund that
   * completes the whole action is notable but not alarming; tune per issuer).
   */
  readonly largeFundingRatio: number;
  /**
   * Claim revert-rate (reverts / attempts) over the rolling window above which
   * we alert a spike. Default 0.25 (25%).
   */
  readonly maxClaimRevertRate: number;
  /** Minimum claim attempts before the revert-rate is meaningful. Default 8. */
  readonly minClaimAttemptsForRate: number;
  /**
   * A sweep whose remainder is at or above this share of `totalFunded` is
   * flagged "large remainder" (most holders never claimed). Default 0.5 (50%).
   */
  readonly largeSweepRemainderRatio: number;
  /**
   * Seconds before an action's `claimDeadline` within which a sweep is expected.
   * A sweep earlier than this (deadline - now > window) is "early" — but note
   * the contract already forbids sweeping before the deadline, so this only ever
   * fires on a deadline=0 / clock-skew anomaly. Default 0 (off; contract-gated).
   */
  readonly earlySweepWindowSecs: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  maxRatePerShare: 10n ** 24n,
  maxTotalPayout: 10n ** 30n,
  largeFundingRatio: 1.0,
  maxClaimRevertRate: 0.25,
  minClaimAttemptsForRate: 8,
  largeSweepRemainderRatio: 0.5,
  earlySweepWindowSecs: 0,
};

/** Fully-resolved monitor configuration (env + flags already merged). */
export interface MonitorConfig {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly registry: Address;
  readonly distributor: Address;
  /** Poll interval in milliseconds for the solvency/state sweep. */
  readonly pollIntervalMs: number;
  /** Webhook URL for the webhook sink, if configured. */
  readonly webhookUrl?: string;
  /** Minimum severity a sink will emit (info|notify|page). Default info. */
  readonly minSeverity: Severity;
  /** Cooldown (ms) for repeat alerts sharing a key. Default 5 min. */
  readonly alertCooldownMs: number;
  /** Anomaly thresholds. */
  readonly thresholds: Thresholds;
  /**
   * Optional allowlist of expected issuer addresses (lowercase). A `Funded`
   * event whose `from` is outside this set is flagged. Empty = no check.
   */
  readonly expectedFunders: readonly Address[];
}
