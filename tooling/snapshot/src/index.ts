/**
 * Public API of `@corporax/snapshot`.
 *
 * Importers (tests, other tooling, the frontend's build step if it ever needs
 * to generate proofs) should pull from here rather than reaching into modules.
 */
export * from "./types.js";
export {
  canonicalLeaf,
  buildTree,
  buildProofs,
  verifyLeaf,
  type LeafRow,
} from "./merkle.js";
export {
  foldTransfers,
  RpcBalanceProvider,
  type ScanOptions,
} from "./balances.js";
export {
  deriveHolders,
  sumPayout,
  sumGross,
  generateSnapshot,
  serializeProofs,
} from "./snapshot.js";
export {
  applyExclusions,
  normalizeExclusions,
  netFromGross,
  assertBps,
} from "./eligibility.js";
export {
  verifyProofs,
  type VerifyResult,
  type VerifyIssue,
} from "./verify.js";
export {
  resolvePinner,
  extractCid,
  HttpPinner,
  NoopPinner,
  NoPinnerConfiguredError,
  type Pinner,
  type PinResult,
  type FetchLike,
  type HttpPinnerOptions,
  type Log,
} from "./pin.js";
