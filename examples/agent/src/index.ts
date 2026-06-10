/**
 * @corporax/example-agent — public surface.
 *
 * A dividend-aware autonomous agent for CorporaX / CAE-1. The decision core
 * (`decideOnAnnouncement`) is pure and unit-tested; the rest subscribes to
 * `ActionAnnounced` and prints strategy decisions. See README.md.
 */
export {
  ActionType,
  ActionStatus,
  actionTypeName,
  actionStatusName,
  ONE,
  type ActionAnnouncedEvent,
  type Holdings,
  type StrategyDecision,
  type DecisionKind,
} from "./types.js";

export {
  decideOnAnnouncement,
  computeEligibleClaim,
  formatUnits,
} from "./strategy.js";

export {
  resolveConfig,
  parseHoldings,
  makeClient,
  toAnnouncedEvent,
  watchAnnouncements,
  type AgentConfig,
  type DeploymentsFile,
} from "./agent.js";

export {
  payForData,
  type PaymentChallenge,
  type PaymentReceipt,
  type PremiumActionInsight,
  type PayForDataOptions,
  type PayForDataResult,
} from "./x402.js";
