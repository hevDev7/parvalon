// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IActionSource } from "./interfaces/IActionSource.sol";
import { ICorporateActionRegistry } from "./interfaces/ICorporateActionRegistry.sol";
import { ActionStatus, ActionType, ActionView, CorporateAction } from "./libraries/CorporateActionTypes.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title CorporateActionRegistry
/// @author Parvalon
/// @notice Immutable on-chain ledger for corporate actions on tokenized stocks.
///         It records announcements, enforces record-date semantics, stores the
///         snapshot Merkle root, and is the single authority over an action's
///         lifecycle status. Value never touches this contract — it only governs
///         state. The {DividendDistributor} reads from here and is the only party
///         permitted to advance an action into CLAIMABLE / FINALIZED.
/// @dev Design: immutable, no proxy, no delegatecall (PRD §11). Access is split
///      three ways — per-asset issuers (operational), the linked distributor
///      (lifecycle), and an admin (governance, documented as a multisig in
///      production). The `actionSource` is the swappable D3 oracle seam.
contract CorporateActionRegistry is ICorporateActionRegistry, AccessControl, Pausable {
    /*//////////////////////////////////////////////////////////////
                                 ROLES
    //////////////////////////////////////////////////////////////*/

    /// @notice Held by the {DividendDistributor}; gates lifecycle advancement.
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    /// @notice May pause/unpause issuer operations in an emergency.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @dev The Arbitrum ArbSys precompile address (present on Arbitrum/Orbit).
    address private constant ARB_SYS = 0x0000000000000000000000000000000000000064;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    uint256 private _actionCount;
    mapping(uint256 id => CorporateAction action) private _actions;
    mapping(address asset => address issuer) private _assetIssuer;
    IActionSource private _actionSource;

    /*//////////////////////////////////////////////////////////////
                               CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param admin         Governance address (multisig in production). Receives
    ///                      DEFAULT_ADMIN_ROLE and PAUSER_ROLE.
    /// @param initialSource The action-source oracle (D3). For testnet this is an
    ///                      {AdminActionSource}; in production a Chainlink adapter.
    constructor(address admin, address initialSource) {
        if (admin == address(0)) revert InvalidParams("admin=0");
        if (initialSource == address(0)) revert InvalidParams("source=0");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _actionSource = IActionSource(initialSource);
        emit ActionSourceUpdated(address(0), initialSource);
    }

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Restricts to the issuer authorized for `asset`. Emits a domain-specific
    ///      {Unauthorized} rather than a generic role error so the UI can react.
    modifier onlyIssuer(address asset) {
        if (msg.sender != _assetIssuer[asset]) revert Unauthorized(msg.sender, asset);
        _;
    }

    /// @dev Restricts to the linked distributor (lifecycle advancement only).
    modifier onlyDistributor() {
        if (!hasRole(DISTRIBUTOR_ROLE, msg.sender)) revert NotDistributor(msg.sender);
        _;
    }

    /*//////////////////////////////////////////////////////////////
                            ISSUER OPERATIONS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc ICorporateActionRegistry
    function announceAction(
        address asset,
        ActionType actionType,
        uint256 ratePerShare,
        uint64 recordBlock,
        uint64 payableAt,
        uint64 claimDeadline,
        address payoutToken,
        string calldata metadataURI
    ) external whenNotPaused onlyIssuer(asset) returns (uint256 id) {
        if (asset == address(0)) revert InvalidParams("asset=0");

        if (actionType == ActionType.CASH_DIVIDEND) {
            if (ratePerShare == 0) revert InvalidParams("ratePerShare=0");
            if (payoutToken == address(0)) revert InvalidParams("payoutToken=0");
            if (payableAt == 0) revert InvalidParams("payableAt=0");
            // A deadline is optional, but if present it must follow the payable date.
            if (claimDeadline != 0 && claimDeadline <= payableAt) {
                revert InvalidParams("claimDeadline<=payableAt");
            }
        } else {
            // Informational actions (split / stock dividend) carry no cash mechanics.
            if (ratePerShare != 0) revert InvalidParams("ratePerShare!=0 for informational");
            if (payoutToken != address(0)) revert InvalidParams("payoutToken!=0 for informational");
        }

        // D3 seam: consult the configured source of truth before recording.
        // For testnet this is an issuer-fed attestation; in production a data-vendor
        // adapter. A non-vouched announcement reverts inside the source.
        bytes32 dataHash = keccak256(
            abi.encode(asset, actionType, ratePerShare, recordBlock, payableAt, claimDeadline, payoutToken, metadataURI)
        );
        _actionSource.validateAnnouncement(asset, msg.sender, dataHash);

        id = ++_actionCount;
        _actions[id] = CorporateAction({
            id: id,
            asset: asset,
            actionType: actionType,
            ratePerShare: ratePerShare,
            recordBlock: recordBlock,
            payableAt: payableAt,
            claimDeadline: claimDeadline,
            payoutToken: payoutToken,
            merkleRoot: bytes32(0),
            totalPayout: 0,
            status: ActionStatus.ANNOUNCED,
            metadataURI: metadataURI
        });

        emit ActionAnnounced(
            id, asset, actionType, ratePerShare, recordBlock, payableAt, claimDeadline, payoutToken, metadataURI
        );
    }

    /// @inheritdoc ICorporateActionRegistry
    function publishRoot(uint256 id, bytes32 root, uint256 totalPayout, uint256 holderCount) external whenNotPaused {
        CorporateAction storage a = _requireAction(id);
        if (msg.sender != _assetIssuer[a.asset]) revert Unauthorized(msg.sender, a.asset);
        if (a.actionType != ActionType.CASH_DIVIDEND) revert InvalidParams("not a dividend");
        if (a.status != ActionStatus.ANNOUNCED) {
            revert InvalidStatus(id, a.status, ActionStatus.ANNOUNCED);
        }
        // Record-date semantics: the snapshot block must be in the past so the
        // balance set is final and the root is reproducible (FR-3). On Arbitrum/Orbit
        // the EVM `block.number` is the L1 block, which disagrees with the L2 block
        // the snapshot tooling keys on; `_recordChainBlock()` returns the L2 number so
        // the on-chain guard and the off-chain snapshot stay on the same clock.
        uint256 nowBlock = _recordChainBlock();
        if (nowBlock <= a.recordBlock) revert RecordNotTaken(id, a.recordBlock, nowBlock);
        if (root == bytes32(0)) revert InvalidParams("root=0");
        if (totalPayout == 0) revert InvalidParams("totalPayout=0");

        a.merkleRoot = root;
        a.totalPayout = totalPayout;
        _setStatus(a, ActionStatus.ROOT_PUBLISHED);

        emit MerkleRootPublished(id, root, totalPayout, holderCount);
    }

    /// @inheritdoc ICorporateActionRegistry
    function cancelAction(uint256 id) external {
        CorporateAction storage a = _requireAction(id);
        if (msg.sender != _assetIssuer[a.asset]) revert Unauthorized(msg.sender, a.asset);
        // Cancellation is restricted to ANNOUNCED. Funding can only begin once an
        // action is ROOT_PUBLISHED, so this guarantees no tokens are ever stranded
        // in the distributor by a cancellation (a CANCELLED action has no exit path
        // for funds). To retire a published action instead, fund it and sweep.
        if (a.status != ActionStatus.ANNOUNCED) {
            revert InvalidStatus(id, a.status, ActionStatus.ANNOUNCED);
        }
        _setStatus(a, ActionStatus.CANCELLED);
    }

    /*//////////////////////////////////////////////////////////////
                       DISTRIBUTOR-ONLY LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc ICorporateActionRegistry
    function markClaimable(uint256 id) external onlyDistributor {
        CorporateAction storage a = _requireAction(id);
        if (a.status != ActionStatus.ROOT_PUBLISHED) {
            revert InvalidStatus(id, a.status, ActionStatus.ROOT_PUBLISHED);
        }
        _setStatus(a, ActionStatus.CLAIMABLE);
    }

    /// @inheritdoc ICorporateActionRegistry
    function markFinalized(uint256 id) external onlyDistributor {
        CorporateAction storage a = _requireAction(id);
        if (a.status != ActionStatus.CLAIMABLE) {
            revert InvalidStatus(id, a.status, ActionStatus.CLAIMABLE);
        }
        _setStatus(a, ActionStatus.FINALIZED);
    }

    /// @inheritdoc ICorporateActionRegistry
    function cancelPublishedAction(uint256 id) external onlyDistributor {
        CorporateAction storage a = _requireAction(id);
        // Distributor-gated so it is reachable only via the distributor's refund
        // flow, which returns any escrowed funds in the same tx. ROOT_PUBLISHED is
        // pre-CLAIMABLE, so no claim can have occurred — CANCELLED stays the
        // "voided before any claim" terminal state.
        if (a.status != ActionStatus.ROOT_PUBLISHED) {
            revert InvalidStatus(id, a.status, ActionStatus.ROOT_PUBLISHED);
        }
        _setStatus(a, ActionStatus.CANCELLED);
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN GOVERNANCE
    //////////////////////////////////////////////////////////////*/

    /// @notice Assign or change the issuer authorized to manage actions for `asset`.
    /// @dev In production this is a deliberate onboarding step per issuer.
    function setAssetIssuer(address asset, address issuer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (asset == address(0)) revert InvalidParams("asset=0");
        if (issuer == address(0)) revert InvalidParams("issuer=0");
        address previous = _assetIssuer[asset];
        _assetIssuer[asset] = issuer;
        emit AssetIssuerSet(asset, previous, issuer);
    }

    /// @notice Swap the action-source oracle (D3). Does not affect existing actions.
    function setActionSource(address newSource) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newSource == address(0)) revert InvalidParams("source=0");
        address previous = address(_actionSource);
        _actionSource = IActionSource(newSource);
        emit ActionSourceUpdated(previous, newSource);
    }

    /// @notice Emergency stop for issuer operations.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Resume issuer operations.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc ICorporateActionRegistry
    function getAction(uint256 id) external view returns (CorporateAction memory) {
        return _requireAction(id);
    }

    /// @inheritdoc ICorporateActionRegistry
    function actionView(uint256 id) external view returns (ActionView memory) {
        CorporateAction storage a = _requireAction(id);
        return ActionView({
            actionType: a.actionType,
            status: a.status,
            payableAt: a.payableAt,
            claimDeadline: a.claimDeadline,
            asset: a.asset,
            payoutToken: a.payoutToken,
            merkleRoot: a.merkleRoot,
            totalPayout: a.totalPayout
        });
    }

    /// @inheritdoc ICorporateActionRegistry
    function actionCount() external view returns (uint256) {
        return _actionCount;
    }

    /// @inheritdoc ICorporateActionRegistry
    function assetIssuer(address asset) external view returns (address) {
        return _assetIssuer[asset];
    }

    /// @inheritdoc ICorporateActionRegistry
    function actionSource() external view returns (address) {
        return address(_actionSource);
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    /// @dev The block number record-date enforcement compares against. On
    ///      Arbitrum/Orbit it returns the L2 block number via the ArbSys precompile
    ///      (`arbBlockNumber()`), so the on-chain guard matches the L2 height the
    ///      snapshot tooling reads — the raw EVM `block.number` on Orbit is the L1
    ///      block, which would make the guard unsatisfiable. A low-level staticcall
    ///      is used (not `extcodesize`, whose value for precompiles is
    ///      implementation-defined): when ArbSys is absent (local anvil / non-Arbitrum)
    ///      the call returns no data and we fall back to `block.number`.
    function _recordChainBlock() private view returns (uint256) {
        (bool ok, bytes memory ret) = ARB_SYS.staticcall(abi.encodeWithSignature("arbBlockNumber()"));
        if (ok && ret.length == 32) {
            return abi.decode(ret, (uint256));
        }
        return block.number;
    }

    /// @dev Loads an action by id, reverting {ActionNotFound} when absent.
    function _requireAction(uint256 id) private view returns (CorporateAction storage a) {
        a = _actions[id];
        if (a.id == 0) revert ActionNotFound(id);
    }

    /// @dev Single chokepoint for status transitions so every change emits.
    function _setStatus(CorporateAction storage a, ActionStatus newStatus) private {
        ActionStatus previous = a.status;
        a.status = newStatus;
        emit ActionStatusChanged(a.id, previous, newStatus);
    }
}
