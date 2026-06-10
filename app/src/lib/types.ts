/** Shared UI types mirroring the on-chain CAE-1 model (see docs/INTEGRATION.md). */

export type ActionTypeName = "CASH_DIVIDEND" | "STOCK_SPLIT" | "STOCK_DIVIDEND";
export type ActionStatusName = "ANNOUNCED" | "ROOT_PUBLISHED" | "CLAIMABLE" | "FINALIZED" | "CANCELLED";

export const ACTION_TYPES: ActionTypeName[] = ["CASH_DIVIDEND", "STOCK_SPLIT", "STOCK_DIVIDEND"];
export const ACTION_STATUSES: ActionStatusName[] = [
  "ANNOUNCED",
  "ROOT_PUBLISHED",
  "CLAIMABLE",
  "FINALIZED",
  "CANCELLED",
];

/** A corporate action shaped for the UI (wei kept as strings to preserve precision). */
export interface ActionView {
  id: number;
  asset: `0x${string}`;
  assetSymbol: string;
  actionType: ActionTypeName;
  status: ActionStatusName;
  ratePerShareWei: string;
  recordBlock: number;
  payableAt: number;
  claimDeadline: number;
  payoutToken: `0x${string}`;
  payoutSymbol: string;
  merkleRoot: `0x${string}`;
  totalPayoutWei: string;
  totalFundedWei: string;
  totalClaimedWei: string;
  metadataURI: string;
}

/** corporax-merkle-v1 proofs.json (see INTEGRATION.md §5). */
export interface ProofsFile {
  format: "corporax-merkle-v1";
  actionId: string;
  chainId: number;
  asset: `0x${string}`;
  payoutToken: `0x${string}`;
  ratePerShare: string;
  recordBlock: number;
  merkleRoot: `0x${string}`;
  totalPayout: string;
  holderCount: number;
  leafEncoding: string[];
  claims: Record<string, { index: number; amount: string; proof: `0x${string}`[] }>;
}

/** Minimal action shape needed to resolve a holder's eligible claims. */
export type ActionLike = Pick<
  ActionView,
  "id" | "actionType" | "status" | "payoutToken" | "payoutSymbol" | "assetSymbol" | "metadataURI"
>;

export interface EligibleClaim {
  actionId: number;
  index: number;
  account: `0x${string}`;
  amountWei: string;
  proof: `0x${string}`[];
  payoutToken: `0x${string}`;
  payoutSymbol: string;
  assetSymbol: string;
  metadataURI: string;
  status: ActionStatusName;
}
