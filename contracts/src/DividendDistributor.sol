// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ICorporateActionRegistry } from "./interfaces/ICorporateActionRegistry.sol";
import { IDividendDistributor } from "./interfaces/IDividendDistributor.sol";
import { ActionStatus, ActionType, ActionView } from "./libraries/CorporateActionTypes.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { BitMaps } from "@openzeppelin/contracts/utils/structs/BitMaps.sol";

/// @title DividendDistributor
/// @author Parvalon
/// @notice Custodies and settles cash dividends for CASH_DIVIDEND actions recorded
///         in the {CorporateActionRegistry}. Issuers fund a published action; once
///         fully funded it becomes CLAIMABLE and holders (or anyone on their behalf)
///         claim pro-rata USDG against the snapshot Merkle root; the issuer sweeps
///         any remainder after the claim deadline.
/// @dev Security posture (PRD §11): immutable, no delegatecall, no upgradeability.
///      Every external mutator is `nonReentrant`, follows checks-effects-interactions,
///      and moves tokens only via {SafeERC20}. Claims are O(1) using a per-action
///      {BitMaps.BitMap}. Funds for one action are never accounted against another.
contract DividendDistributor is IDividendDistributor, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BitMaps for BitMaps.BitMap;

    /// @notice May pause/unpause funding and claiming in an emergency.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice The registry this distributor settles against. Immutable by design.
    ICorporateActionRegistry public immutable REGISTRY;

    /// @dev action id => consumed claim indices.
    mapping(uint256 id => BitMaps.BitMap bitmap) private _claimed;
    /// @dev action id => cumulative funded.
    mapping(uint256 id => uint256 funded) private _funded;
    /// @dev action id => cumulative claimed.
    mapping(uint256 id => uint256 claimed) private _claimedTotal;

    /// @param registry_ The {CorporateActionRegistry} address.
    /// @param admin     Governance address (multisig in production); gets admin + pauser.
    constructor(address registry_, address admin) {
        if (registry_ == address(0) || admin == address(0)) revert ZeroAddress();
        REGISTRY = ICorporateActionRegistry(registry_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    /*//////////////////////////////////////////////////////////////
                               OPERATIONS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IDividendDistributor
    function fund(uint256 id, uint256 amount) external nonReentrant whenNotPaused {
        ActionView memory a = REGISTRY.actionView(id);
        if (a.actionType != ActionType.CASH_DIVIDEND) revert NotADividend(id);
        if (a.status != ActionStatus.ROOT_PUBLISHED) revert WrongStatus(id);
        if (amount == 0) revert ZeroAmount(id);

        // Credit the ACTUAL balance received, not the requested amount, so a
        // fee-on-transfer / rebasing payout token can never mark an action
        // CLAIMABLE while the contract holds less than `totalPayout`. Safe to
        // transfer before updating state under `nonReentrant`.
        IERC20 token = IERC20(a.payoutToken);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;

        uint256 newFunded = _funded[id] + received;
        if (newFunded > a.totalPayout) revert Overfunded(id, newFunded, a.totalPayout);

        _funded[id] = newFunded;
        emit Funded(id, msg.sender, received, newFunded);

        // `>=` is equivalent to `==` here (the Overfunded check above caps newFunded
        // at totalPayout) but avoids a balance-derived strict equality.
        if (newFunded >= a.totalPayout) {
            REGISTRY.markClaimable(id);
        }
    }

    /// @inheritdoc IDividendDistributor
    function claim(uint256 id, uint256 index, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
        whenNotPaused
    {
        ActionView memory a = REGISTRY.actionView(id);
        if (a.actionType != ActionType.CASH_DIVIDEND) revert NotADividend(id);
        if (a.status != ActionStatus.CLAIMABLE) revert WrongStatus(id);
        if (block.timestamp < a.payableAt) revert NotYetClaimable(id, a.payableAt);
        if (_claimed[id].get(index)) revert AlreadyClaimed(id, index);

        // OZ StandardMerkleTree leaf: double-keccak of abi.encode(values). Binding
        // the action id into the leaf makes proofs non-replayable across actions.
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(id, index, account, amount))));
        if (!MerkleProof.verify(proof, a.merkleRoot, leaf)) revert InvalidProof(id, index);

        // Effects. Per-action solvency cap: an action can NEVER pay out more than
        // it was funded, regardless of the published root's leaf sum. This is what
        // isolates one action's funds from every other action sharing the payout
        // token in this contract's pooled balance.
        _claimed[id].set(index);
        uint256 newClaimed = _claimedTotal[id] + amount;
        if (newClaimed > _funded[id]) revert ExceedsFunded(id, newClaimed, _funded[id]);
        _claimedTotal[id] = newClaimed;
        emit Claimed(id, index, account, amount);

        // Interaction — funds always settle to `account` (claim-on-behalf, FR-6).
        IERC20(a.payoutToken).safeTransfer(account, amount);
    }

    /// @inheritdoc IDividendDistributor
    function sweepUnclaimed(uint256 id) external nonReentrant whenNotPaused {
        ActionView memory a = REGISTRY.actionView(id);
        if (a.actionType != ActionType.CASH_DIVIDEND) revert NotADividend(id);
        if (a.status != ActionStatus.CLAIMABLE) revert WrongStatus(id);
        if (a.claimDeadline == 0 || block.timestamp <= a.claimDeadline) {
            revert SweepNotAllowed(id, a.claimDeadline);
        }
        address issuer = REGISTRY.assetIssuer(a.asset);
        if (msg.sender != issuer) revert Unauthorized(msg.sender, id);

        uint256 remaining = _funded[id] - _claimedTotal[id];

        // Effect: finalize first so no claim can race the sweep (claims require CLAIMABLE).
        REGISTRY.markFinalized(id);
        emit UnclaimedSwept(id, issuer, remaining);

        if (remaining > 0) {
            IERC20(a.payoutToken).safeTransfer(issuer, remaining);
        }
    }

    /// @inheritdoc IDividendDistributor
    function cancelPublishedAction(uint256 id) external nonReentrant whenNotPaused {
        ActionView memory a = REGISTRY.actionView(id);
        if (a.actionType != ActionType.CASH_DIVIDEND) revert NotADividend(id);
        if (a.status != ActionStatus.ROOT_PUBLISHED) revert WrongStatus(id);
        address issuer = REGISTRY.assetIssuer(a.asset);
        if (msg.sender != issuer) revert Unauthorized(msg.sender, id);

        // A ROOT_PUBLISHED action is pre-CLAIMABLE, so no claim can have run:
        // `_claimedTotal[id]` is necessarily 0 and the full deposit is recoverable.
        // Effects first (cancel via registry + zero accounting), refund last —
        // mirroring sweepUnclaimed's finalize-then-transfer ordering under nonReentrant.
        uint256 refund = _funded[id];
        _funded[id] = 0;
        REGISTRY.cancelPublishedAction(id);
        emit PublishedActionCancelled(id, issuer, refund);

        if (refund > 0) {
            IERC20(a.payoutToken).safeTransfer(issuer, refund);
        }
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN GOVERNANCE
    //////////////////////////////////////////////////////////////*/

    /// @notice Emergency stop for funding and claiming.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Resume funding and claiming.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IDividendDistributor
    function isClaimed(uint256 id, uint256 index) external view returns (bool) {
        return _claimed[id].get(index);
    }

    /// @inheritdoc IDividendDistributor
    function totalFunded(uint256 id) external view returns (uint256) {
        return _funded[id];
    }

    /// @inheritdoc IDividendDistributor
    function totalClaimed(uint256 id) external view returns (uint256) {
        return _claimedTotal[id];
    }

    /// @inheritdoc IDividendDistributor
    function registry() external view returns (address) {
        return address(REGISTRY);
    }
}
