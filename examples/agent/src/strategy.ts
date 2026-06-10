/**
 * The agent's decision core.
 *
 * `decideOnAnnouncement` is a PURE function: given a decoded CAE-1
 * `ActionAnnounced` event and the agent's current holdings, it returns a
 * `StrategyDecision` with no I/O. This is the unit under test and the heart of
 * the example — everything else (the chain subscription, the CLI printing, the
 * x402 narrative) is plumbing around it.
 *
 * The strategies encoded here are intentionally illustrative but faithful to
 * CAE-1 semantics:
 *   - CASH_DIVIDEND : flag positions for ex-dividend; if held, pre-compute the
 *                     exact eligible claim so the agent can settle it the moment
 *                     the action goes CLAIMABLE (claim-on-behalf, eip-cae1.md).
 *   - STOCK_SPLIT   : signal that the oracle / collateral factor must be rescaled
 *                     at the record block so a forward split is not mistaken for a
 *                     price crash (cf. SplitAwareCollateral.sol).
 *   - STOCK_DIVIDEND: signal that the effective share count will change.
 *   - unknown type  : ignored, per CAE-1's forward-compatibility rule.
 */
import {
  ActionType,
  ONE,
  actionTypeName,
  type ActionAnnouncedEvent,
  type Holdings,
  type StrategyDecision,
} from "./types.js";

/** Look up the agent's held units (1e18-scaled) for an asset; 0 if none. */
function heldUnits(holdings: Holdings, asset: string): bigint {
  return holdings[asset.toLowerCase()] ?? 0n;
}

/**
 * Compute the exact dividend a holder of `units` (1e18-scaled) is owed at
 * `ratePerShare`, matching the canonical leaf rule in INTEGRATION.md §4:
 *   amount = balanceAtRecordBlock * ratePerShare / 1e18
 */
export function computeEligibleClaim(units: bigint, ratePerShare: bigint): bigint {
  return (units * ratePerShare) / ONE;
}

/**
 * Decide what to do about a freshly-announced corporate action.
 *
 * @param event    decoded ActionAnnounced payload
 * @param holdings the agent's book, keyed by lowercase asset address
 */
export function decideOnAnnouncement(
  event: ActionAnnouncedEvent,
  holdings: Holdings,
): StrategyDecision {
  const units = heldUnits(holdings, event.asset);
  const holds = units > 0n;
  const typeName = actionTypeName(event.actionType);

  const base = {
    actionId: event.id,
    asset: event.asset,
    actionType: typeName,
    holds,
  } as const;

  switch (event.actionType) {
    case ActionType.CASH_DIVIDEND: {
      if (holds) {
        const eligibleClaim = computeEligibleClaim(units, event.ratePerShare);
        return {
          ...base,
          kind: "cash-dividend-flag-and-claim",
          eligibleClaim,
          rationale: [
            `${typeName} announced for ${event.asset} (action #${event.id}).`,
            `Record block ${event.recordBlock} — flag this position for ex-dividend.`,
            `Held ${formatUnits(units)} units @ rate ${formatUnits(event.ratePerShare)} ` +
              `=> pre-computed eligible claim ${formatUnits(eligibleClaim)} payout-token units.`,
            `Funds settle to the holder via claim-on-behalf; the agent only triggers it.`,
          ],
          nextActions: [
            `Subscribe to ActionStatusChanged(#${event.id}); when newStatus == CLAIMABLE, ` +
              `fetch the holder's {index, amount, proof} from proofs-<chainId>-${event.id}.json.`,
            `Call DividendDistributor.claim(${event.id}, index, account, amount, proof) ` +
              `before claimDeadline ${event.claimDeadline}.`,
            `Mark the position as going ex-dividend at record block ${event.recordBlock} for valuation.`,
          ],
        };
      }
      return {
        ...base,
        kind: "cash-dividend-watch",
        rationale: [
          `${typeName} announced for ${event.asset} (action #${event.id}), but the book holds none.`,
          `No claim to pre-compute; watch only in case a position is opened before record block ${event.recordBlock}.`,
        ],
        nextActions: [
          `Track ${event.asset}; if a position opens at/under block ${event.recordBlock}, re-evaluate.`,
        ],
      };
    }

    case ActionType.STOCK_SPLIT: {
      return {
        ...base,
        kind: "split-rescale",
        rationale: [
          `${typeName} announced for ${event.asset} (action #${event.id}) — informational in CAE-1 v1.`,
          `Read the split ratio from metadata: ${event.metadataURI}`,
          `Rescale the oracle / collateral factor at record block ${event.recordBlock} so a forward ` +
            `split is not mistaken for a price crash (cf. SplitAwareCollateral.sol).`,
          holds
            ? `Position is exposed to ${event.asset}; rescaling protects against spurious liquidation.`
            : `No position in ${event.asset}; rescale any derived quotes/pools that reference it.`,
        ],
        nextActions: [
          `Parse newShares:oldShares from ${event.metadataURI}.`,
          `Apply idempotent rescale keyed by action #${event.id} at block ${event.recordBlock}.`,
        ],
      };
    }

    case ActionType.STOCK_DIVIDEND: {
      return {
        ...base,
        kind: "stock-dividend-rescale",
        rationale: [
          `${typeName} announced for ${event.asset} (action #${event.id}) — informational in CAE-1 v1.`,
          `Additional-shares ratio is in metadata: ${event.metadataURI}`,
          `Effective share count rises at record block ${event.recordBlock}; adjust per-share metrics.`,
        ],
        nextActions: [
          `Parse the additional-shares ratio from ${event.metadataURI}.`,
          `Rescale per-share valuation idempotently, keyed by action #${event.id}.`,
        ],
      };
    }

    default: {
      // CAE-1 forward-compat: ignore unknown ActionType values rather than reject.
      return {
        ...base,
        kind: "ignore-unknown",
        rationale: [
          `Unknown ActionType ${event.actionType} for action #${event.id}; ignoring per CAE-1 ` +
            `forward-compatibility (eip-cae1.md, Backwards Compatibility).`,
        ],
        nextActions: [],
      };
    }
  }
}

/**
 * Format a 1e18-scaled bigint as a human-decimal string (best-effort, for
 * console output only — never use this for value-bearing math).
 */
export function formatUnits(value: bigint): string {
  const whole = value / ONE;
  const frac = value % ONE;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}
