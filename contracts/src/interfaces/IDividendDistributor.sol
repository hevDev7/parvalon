// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IDividendDistributor
/// @author CorporaX
/// @notice Holds and pays out cash dividends for actions recorded in the
///         {ICorporateActionRegistry}. Funding moves an action to CLAIMABLE;
///         holders (or anyone acting on their behalf) then claim pro-rata USDG
///         against the published Merkle root; the issuer sweeps any remainder
///         after the claim deadline.
/// @dev Claims are O(1): a per-action {BitMaps.BitMap} marks consumed indices and
///      a single {SafeERC20} transfer settles each claim. All transfers follow
///      checks-effects-interactions and run under `nonReentrant`.
interface IDividendDistributor {
    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted on every funding deposit toward an action.
    event Funded(uint256 indexed id, address indexed from, uint256 amount, uint256 totalFunded);

    /// @notice Emitted on every successful claim. Part of CAE-1.
    /// @param index   The holder's leaf index (also the bitmap slot consumed).
    /// @param account The beneficiary — funds always go here, never to msg.sender.
    event Claimed(uint256 indexed id, uint256 index, address indexed account, uint256 amount);

    /// @notice Emitted when the issuer sweeps unclaimed funds after the deadline.
    event UnclaimedSwept(uint256 indexed id, address indexed to, uint256 amount);

    /// @notice Emitted when the issuer cancels a ROOT_PUBLISHED action before it
    ///         becomes claimable; `refund` is the partial funding returned to them.
    event PublishedActionCancelled(uint256 indexed id, address indexed issuer, uint256 refund);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @notice A constructor argument was the zero address.
    error ZeroAddress();
    /// @notice A non-positive amount was supplied where a positive one is required.
    error ZeroAmount(uint256 id);
    /// @notice The action is not a CASH_DIVIDEND and cannot be funded/claimed.
    error NotADividend(uint256 id);
    /// @notice Action is not in the status this operation requires.
    error WrongStatus(uint256 id);
    /// @notice Funding would exceed the published totalPayout.
    error Overfunded(uint256 id, uint256 attempted, uint256 cap);
    /// @notice Cumulative claims would exceed the amount actually funded for this
    ///         action — the per-action solvency cap that isolates pooled funds.
    error ExceedsFunded(uint256 id, uint256 attempted, uint256 funded);
    /// @notice The Merkle proof did not verify against the action's root.
    error InvalidProof(uint256 id, uint256 index);
    /// @notice This (action, index) leaf was already claimed.
    error AlreadyClaimed(uint256 id, uint256 index);
    /// @notice Claim attempted before `payableAt`.
    error NotYetClaimable(uint256 id, uint64 payableAt);
    /// @notice Sweep attempted before `claimDeadline`, or no deadline was set.
    error SweepNotAllowed(uint256 id, uint64 claimDeadline);
    /// @notice Caller is not the issuer for the action's asset.
    error Unauthorized(address caller, uint256 id);

    /*//////////////////////////////////////////////////////////////
                               OPERATIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Deposit `amount` of the action's payout token toward its funding
    ///         target. When cumulative funding reaches `totalPayout` the action
    ///         is advanced to CLAIMABLE in the registry.
    /// @dev Pulls via `safeTransferFrom`; caller must have approved this contract.
    function fund(uint256 id, uint256 amount) external;

    /// @notice Claim `amount` of payout for `account` against the Merkle root.
    /// @dev Claim-on-behalf (FR-6): anyone may submit, but funds always settle to
    ///      `account`. This is what makes gasless relays and agent automation safe.
    /// @param id      The action id.
    /// @param index   The beneficiary's leaf index (bitmap slot).
    /// @param account The beneficiary; must match the leaf.
    /// @param amount  The exact pro-rata amount from the snapshot; must match the leaf.
    /// @param proof   StandardMerkleTree proof for the leaf.
    function claim(uint256 id, uint256 index, address account, uint256 amount, bytes32[] calldata proof) external;

    /// @notice Return unclaimed funds to the issuer after `claimDeadline`.
    ///         Advances the action to FINALIZED.
    function sweepUnclaimed(uint256 id) external;

    /// @notice Recover a ROOT_PUBLISHED action the issuer chooses to abandon before
    ///         it becomes CLAIMABLE: refunds any partial funding and cancels the
    ///         action. Issuer-only. This is the exit for a published action that is
    ///         never fully funded (claim and sweep both require CLAIMABLE), so it
    ///         cannot strand issuer capital. Safe by construction: no claim is
    ///         possible before CLAIMABLE, so the full deposit is recoverable.
    function cancelPublishedAction(uint256 id) external;

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice Whether the (action, index) leaf has been claimed.
    function isClaimed(uint256 id, uint256 index) external view returns (bool);

    /// @notice Cumulative amount funded toward an action.
    function totalFunded(uint256 id) external view returns (uint256);

    /// @notice Cumulative amount claimed from an action.
    function totalClaimed(uint256 id) external view returns (uint256);

    /// @notice The registry this distributor settles against.
    function registry() external view returns (address);
}
