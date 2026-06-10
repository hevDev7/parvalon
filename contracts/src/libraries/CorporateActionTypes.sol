// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title CorporateActionTypes
/// @author CorporaX
/// @notice Canonical data types shared by the registry, distributor and every
///         off-chain consumer (snapshot CLI, indexer, frontend). These types are
///         the on-chain half of the **CAE-1** (Corporate Action Events) schema.
/// @dev Defined at file scope so they form a single source of truth that both
///      contracts and interfaces import. Do not duplicate these definitions.

/// @notice The class of corporate action being represented.
/// @dev `CASH_DIVIDEND` is the only type that flows value through the
///      DividendDistributor. `STOCK_SPLIT` / `STOCK_DIVIDEND` are *informational*
///      actions in v1 (signal + ratio metadata) because CorporaX deliberately
///      does not control the underlying token and therefore cannot rebase it.
enum ActionType {
    CASH_DIVIDEND, // 0 — pro-rata cash (USDG) distribution, claimable by holders
    STOCK_SPLIT, //    1 — informational: forward/reverse split ratio in metadata
    STOCK_DIVIDEND //  2 — informational: additional-shares ratio in metadata
}

/// @notice Lifecycle of a corporate action.
/// @dev Forward-only transitions, enforced in the registry:
///      ANNOUNCED -> ROOT_PUBLISHED -> CLAIMABLE -> FINALIZED, plus the terminal
///      CANCELLED reachable only from ANNOUNCED / ROOT_PUBLISHED (never after a
///      single wei has been claimed). Informational actions live as ANNOUNCED
///      and may move directly to FINALIZED.
enum ActionStatus {
    ANNOUNCED, //      0 — recorded on-chain; record block may or may not have passed
    ROOT_PUBLISHED, // 1 — Merkle root + totalPayout published; awaiting funding
    CLAIMABLE, //      2 — fully funded; holders may claim
    FINALIZED, //      3 — claim window closed and any remainder swept
    CANCELLED //       4 — voided before any claim occurred
}

/// @notice The full on-chain record of a corporate action.
/// @dev Field packing note: `recordBlock`, `payableAt`, `claimDeadline` and the
///      enums are intentionally sub-256-bit but are NOT tightly slot-packed with
///      the surrounding `uint256`/`address`/`bytes32` fields because clarity for
///      auditors is worth more than the marginal SSTORE saving on a low-frequency
///      issuer write. Gas optimisation is concentrated where it is felt: claims.
struct CorporateAction {
    uint256 id; //            unique, monotonic per registry
    address asset; //         underlying tokenized stock (TSLA, AMZN, ...) — read-only to us
    ActionType actionType; //
    uint256 ratePerShare; //  payout per 1e18 units of `asset` (CASH_DIVIDEND); 0 for informational
    uint64 recordBlock; //    snapshot block — the on-chain "record date"
    uint64 payableAt; //      unix ts at/after which claims open
    uint64 claimDeadline; //  unix ts after which sweepUnclaimed is allowed (0 = no deadline)
    address payoutToken; //   settlement asset (USDG); address(0) for informational actions
    bytes32 merkleRoot; //    StandardMerkleTree root over eligible (index, account, amount) leaves
    uint256 totalPayout; //   sum of all leaf amounts — the exact funding target
    ActionStatus status; //
    string metadataURI; //    off-chain JSON (ticker, ex-date, split ratio, tax flags, ...)
}

/// @notice The subset of {CorporateAction} the {DividendDistributor} needs on its
///         hot path (fund/claim/sweep). Excludes the `metadataURI` string so the
///         distributor never pays to copy unbounded calldata on every claim — a
///         deliberate gas optimisation over reading the full struct.
struct ActionView {
    ActionType actionType;
    ActionStatus status;
    uint64 payableAt;
    uint64 claimDeadline;
    address asset;
    address payoutToken;
    bytes32 merkleRoot;
    uint256 totalPayout;
}
