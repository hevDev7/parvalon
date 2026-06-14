/**
 * Shared types & enumerations for the Parvalon example agent.
 *
 * The enum values are FROZEN by INTEGRATION.md §2 and docs/eip/eip-cae1.md.
 * Keep them numeric (the wire encoding is uint8) and expose name lookups for
 * human-readable strategy output.
 */
import type { Address, Hex } from "viem";

/** CAE-1 ActionType (uint8). Frozen by INTEGRATION.md §2. */
export enum ActionType {
  CASH_DIVIDEND = 0,
  STOCK_SPLIT = 1,
  STOCK_DIVIDEND = 2,
}

/** CAE-1 ActionStatus (uint8). Frozen by INTEGRATION.md §2. */
export enum ActionStatus {
  ANNOUNCED = 0,
  ROOT_PUBLISHED = 1,
  CLAIMABLE = 2,
  FINALIZED = 3,
  CANCELLED = 4,
}

/** Human-readable name for an ActionType uint8, tolerant of unknown values. */
export function actionTypeName(value: number): string {
  return ActionType[value] ?? `UNKNOWN(${value})`;
}

/** Human-readable name for an ActionStatus uint8, tolerant of unknown values. */
export function actionStatusName(value: number): string {
  return ActionStatus[value] ?? `UNKNOWN(${value})`;
}

/**
 * Decoded `ActionAnnounced` event payload (the CAE-1 announcement), as the
 * agent's decision function consumes it. Mirrors the event signature in
 * INTEGRATION.md §3 and eip-cae1.md, with bigint for the uint fields.
 */
export interface ActionAnnouncedEvent {
  readonly id: bigint;
  readonly asset: Address;
  readonly actionType: number; // ActionType (uint8)
  readonly ratePerShare: bigint; // payout per 1e18 units of asset
  readonly recordBlock: bigint; // uint64 on-chain; widened to bigint here
  readonly payableAt: bigint; // unix ts (uint64)
  readonly claimDeadline: bigint; // unix ts (uint64); 0 = none
  readonly payoutToken: Address; // address(0) for informational actions
  readonly metadataURI: string;
}

/**
 * The agent's view of its own book: which assets it holds (by address) and how
 * many 1e18-scaled units of each. In a real agent this comes from a wallet /
 * custody integration; here it is injected so the decision logic stays pure and
 * unit-testable.
 */
export type Holdings = Readonly<Record<string, bigint>>;

/** A single, self-contained strategy decision the agent emits per action. */
export interface StrategyDecision {
  /** The action this decision is about. */
  readonly actionId: bigint;
  /** Asset the action targets. */
  readonly asset: Address;
  /** Resolved ActionType name (e.g. "CASH_DIVIDEND"). */
  readonly actionType: string;
  /** A short machine tag for the decision kind. */
  readonly kind: DecisionKind;
  /** Whether the agent's book is exposed to this asset. */
  readonly holds: boolean;
  /**
   * For a held CASH_DIVIDEND, the pre-computed eligible claim amount in payout-
   * token base units: `heldUnits * ratePerShare / 1e18`. Undefined otherwise.
   */
  readonly eligibleClaim?: bigint;
  /** Human-readable lines the CLI prints. */
  readonly rationale: readonly string[];
  /** Concrete next actions the agent (or its operator) should take. */
  readonly nextActions: readonly string[];
}

export type DecisionKind =
  | "cash-dividend-flag-and-claim" // held CASH_DIVIDEND: flag ex-dividend, pre-compute claim
  | "cash-dividend-watch" // not held CASH_DIVIDEND: watch only
  | "split-rescale" // STOCK_SPLIT: rescale oracle / collateral
  | "stock-dividend-rescale" // STOCK_DIVIDEND: rescale share count
  | "ignore-unknown"; // unknown ActionType: ignore per CAE-1 forward-compat

/** 1e18 fixed-point scale used by `ratePerShare`. */
export const ONE = 10n ** 18n;

export type { Address, Hex };
