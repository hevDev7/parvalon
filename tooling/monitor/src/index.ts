/**
 * Public API of `@parvalon/monitor`.
 *
 * Importers (tests, dashboards, other tooling) should pull from here rather than
 * reaching into modules. The pure checks in `checks.ts` are the reusable core;
 * `Monitor` is the on-chain orchestrator; the notifier sinks are pluggable.
 */
export * from "./types.js";
export {
  type ActionAccounting,
  type TokenBalance,
  type SolvencyResult,
  type StatusChangedEvent,
  type AnnouncedEvent,
  type RootPublishedEvent,
  type FundedEvent,
  type SweptEvent,
  checkSolvency,
  checkStatusChanged,
  checkAnnounced,
  checkRootPublished,
  checkFunded,
  checkSwept,
  checkPauseChange,
  ClaimHealthTracker,
} from "./checks.js";
export {
  type Notifier,
  type Logger,
  type FetchLike,
  type CompositeOptions,
  ConsoleNotifier,
  WebhookNotifier,
  CompositeNotifier,
  bigintReplacer,
} from "./notifier.js";
export { type CliOverrides, resolveConfig, resolveThresholds } from "./config.js";
export { type ProtocolSnapshot, Monitor } from "./monitor.js";
