/**
 * @corporax/sdk — typed TypeScript/viem client for the CorporaX
 * corporate-actions & dividend protocol.
 *
 * Public surface:
 *  - {@link CorporaXClient} — the high-level façade.
 *  - read / write / event helpers as standalone functions.
 *  - calldata encoders, the canonical Merkle leaf + claim builders.
 *  - the domain types mirroring docs/INTEGRATION.md.
 *
 * Everything conforms to the FROZEN integration contract (enums, struct field
 * order, CAE-1 events, leaf encoding, `corporax-merkle-v1` proofs schema).
 */

// Domain types, enums, names, proofs schema.
export * from "./types.js";

// Canonical Merkle leaf + client-side proof verification.
export { canonicalLeaf, verifyProof } from "./merkle.js";

// proofs.json helpers.
export {
  parseProofsFile,
  eligibleClaimFor,
  allEligibleClaims,
} from "./proofs.js";

// Read helpers (PublicClient).
export {
  getAction,
  actionView,
  actionCount,
  listActions,
  assetIssuer,
  actionSource,
  isClaimed,
  totalFunded,
  totalClaimed,
} from "./reads.js";

// Calldata encoders (pure — no client).
export {
  encodeAnnounceAction,
  encodePublishRoot,
  encodeCancelAction,
  encodeFund,
  encodeClaim,
  encodeSweepUnclaimed,
  encodeApprove,
  claimArgsFromEligible,
  announceActionCalldata,
  publishRootCalldata,
  claimCalldata,
  fundCalldata,
  type AnnounceActionArgs,
  type PublishRootArgs,
  type ClaimArgs,
} from "./encode.js";

// Write helpers (WalletClient).
export {
  announceAction,
  publishRoot,
  cancelAction,
  fund,
  approvePayoutToken,
  fundWithApproval,
  claim,
  claimFromEligible,
  sweepUnclaimed,
  type TxOptions,
} from "./writes.js";

// Event decoders + watchers.
export {
  decodeActionAnnounced,
  decodeMerkleRootPublished,
  decodeActionStatusChanged,
  decodeFunded,
  decodeClaimed,
  decodeUnclaimedSwept,
  watchActionAnnounced,
  watchMerkleRootPublished,
  watchActionStatusChanged,
  watchFunded,
  watchClaimed,
  watchUnclaimedSwept,
  type RawLog,
  type Unwatch,
  type EventHandler,
} from "./events.js";

// Chains.
export {
  robinhoodTestnet,
  arbitrumSepoliaChain,
  localAnvil,
  CHAINS,
  chainById,
  type KnownChainId,
} from "./chains.js";

// High-level client.
export {
  CorporaXClient,
  type CorporaXClientConfig,
} from "./client.js";

// The imported ABIs, re-exported for callers who want them directly.
export {
  registryAbi,
  distributorAbi,
  actionSourceAbi,
  functionsActionSourceAbi,
  erc20Abi,
} from "./generated/abis.js";
