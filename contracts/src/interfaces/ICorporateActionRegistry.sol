// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ActionStatus, ActionType, ActionView, CorporateAction } from "../libraries/CorporateActionTypes.sol";

/// @title ICorporateActionRegistry
/// @author CorporaX
/// @notice The on-chain ledger of corporate actions for tokenized stocks. This
///         is the authoritative source of an action's identity, key dates, Merkle
///         root and lifecycle status. The {IDividendDistributor} reads from it and
///         is the only contract permitted to advance an action into CLAIMABLE /
///         FINALIZED.
/// @dev Every event below is part of the public **CAE-1** schema; off-chain
///      consumers (indexer, AI agents, integrating protocols) subscribe to these.
interface ICorporateActionRegistry {
    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted once per corporate action when it is first recorded.
    /// @dev `metadataURI` carries the human-facing detail (ticker, ex-date, split
    ///      ratio, tax flags). Indexed `asset` lets integrators filter by stock.
    event ActionAnnounced(
        uint256 indexed id,
        address indexed asset,
        ActionType actionType,
        uint256 ratePerShare,
        uint64 recordBlock,
        uint64 payableAt,
        uint64 claimDeadline,
        address payoutToken,
        string metadataURI
    );

    /// @notice Emitted when the issuer publishes the snapshot Merkle root.
    /// @param holderCount Number of eligible holders in the snapshot — a public
    ///        transparency metric (anyone can re-run the snapshot and check).
    event MerkleRootPublished(uint256 indexed id, bytes32 root, uint256 totalPayout, uint256 holderCount);

    /// @notice Emitted on every lifecycle transition.
    event ActionStatusChanged(uint256 indexed id, ActionStatus previousStatus, ActionStatus newStatus);

    /// @notice Emitted when admin assigns/changes the issuer authorized for an asset.
    event AssetIssuerSet(address indexed asset, address indexed previousIssuer, address indexed newIssuer);

    /// @notice Emitted when admin swaps the action-source oracle (D3 seam).
    event ActionSourceUpdated(address indexed previousSource, address indexed newSource);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @notice Caller is not the issuer for `asset` (FR-2).
    error Unauthorized(address caller, address asset);
    /// @notice The action does not exist.
    error ActionNotFound(uint256 id);
    /// @notice Action is not in the status this operation requires.
    error InvalidStatus(uint256 id, ActionStatus current, ActionStatus required);
    /// @notice `publishRoot` called before the record block has passed (FR-3). The
    ///         current block is the L2 block number (ArbSys `arbBlockNumber()` on
    ///         Arbitrum/Orbit, `block.number` off-Arbitrum) — see {publishRoot}.
    error RecordNotTaken(uint256 id, uint64 recordBlock, uint256 currentBlock);
    /// @notice A supplied parameter is structurally invalid (zero address, bad dates...).
    error InvalidParams(string reason);
    /// @notice Caller lacks the role required to advance lifecycle (distributor-only).
    error NotDistributor(address caller);

    /*//////////////////////////////////////////////////////////////
                            ISSUER OPERATIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Record a new corporate action. Caller must be the issuer for `asset`.
    /// @dev Consults the configured {IActionSource} before writing. For
    ///      CASH_DIVIDEND, `payoutToken` and `ratePerShare` must be non-zero; for
    ///      informational actions they should be zero and `metadataURI` carries
    ///      the ratio. Emits {ActionAnnounced}.
    /// @return id The new action's identifier.
    function announceAction(
        address asset,
        ActionType actionType,
        uint256 ratePerShare,
        uint64 recordBlock,
        uint64 payableAt,
        uint64 claimDeadline,
        address payoutToken,
        string calldata metadataURI
    ) external returns (uint256 id);

    /// @notice Publish the snapshot Merkle root and exact funding target.
    /// @dev Valid only when status == ANNOUNCED and the record block has passed,
    ///      compared against the L2 block number (ArbSys `arbBlockNumber()` on
    ///      Arbitrum/Orbit — the same height the snapshot tooling reads — falling
    ///      back to `block.number` off-Arbitrum). Sets status -> ROOT_PUBLISHED;
    ///      the root is immutable thereafter.
    function publishRoot(uint256 id, bytes32 root, uint256 totalPayout, uint256 holderCount) external;

    /// @notice Cancel an ANNOUNCED action before a root is published. Caller must be
    ///         the issuer. To retire a ROOT_PUBLISHED action and recover any partial
    ///         funding, use {IDividendDistributor-cancelPublishedAction} instead — it
    ///         coordinates the refund and the {cancelPublishedAction} transition here.
    function cancelAction(uint256 id) external;

    /*//////////////////////////////////////////////////////////////
                       DISTRIBUTOR-ONLY LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    /// @notice Advance ROOT_PUBLISHED -> CLAIMABLE. Restricted to the linked distributor.
    function markClaimable(uint256 id) external;

    /// @notice Advance CLAIMABLE -> FINALIZED. Restricted to the linked distributor.
    function markFinalized(uint256 id) external;

    /// @notice Cancel a ROOT_PUBLISHED action, moving it to the terminal CANCELLED
    ///         state. Restricted to the linked distributor, which calls this only
    ///         from {IDividendDistributor-cancelPublishedAction} so any partially
    ///         deposited funds are refunded to the issuer in the same transaction.
    ///         Safe because no claim can occur before CLAIMABLE.
    function cancelPublishedAction(uint256 id) external;

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice Full action record. Reverts {ActionNotFound} for unknown ids.
    function getAction(uint256 id) external view returns (CorporateAction memory);

    /// @notice Gas-lean projection for the distributor hot path (no metadataURI).
    ///         Reverts {ActionNotFound} for unknown ids.
    function actionView(uint256 id) external view returns (ActionView memory);

    /// @notice Number of actions recorded (ids run 1..actionCount).
    function actionCount() external view returns (uint256);

    /// @notice The issuer authorized to manage actions for `asset` (address(0) if none).
    function assetIssuer(address asset) external view returns (address);

    /// @notice The currently configured action-source oracle (D3 seam).
    function actionSource() external view returns (address);
}
