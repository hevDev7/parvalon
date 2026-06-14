// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CorporateActionRegistry } from "../src/CorporateActionRegistry.sol";
import { DividendDistributor } from "../src/DividendDistributor.sol";
import { ActionType } from "../src/libraries/CorporateActionTypes.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { AdminActionSource } from "../src/oracle/AdminActionSource.sol";
import { MerkleHelper } from "./utils/MerkleHelper.sol";
import { Test } from "forge-std/Test.sol";

/// @notice Shared deployment + lifecycle helpers for the Parvalon test suite.
/// @dev Mirrors the real deploy order: source -> registry -> distributor -> grant
///      DISTRIBUTOR_ROLE -> onboard an issuer for the asset.
abstract contract BaseTest is Test {
    using MerkleHelper for bytes32[];

    // Actors
    address internal admin = address(this);
    address internal issuer = makeAddr("issuer");
    address internal dina = makeAddr("dina"); // retail holder P1
    address internal leo = makeAddr("leo"); // integrator / second holder
    address internal relayer = makeAddr("relayer"); // claims on behalf
    address internal attacker = makeAddr("attacker");

    // Contracts
    AdminActionSource internal source;
    CorporateActionRegistry internal registry;
    DividendDistributor internal distributor;
    MockERC20 internal usdg; // payout token
    MockERC20 internal tsla; // tokenized stock (snapshot source)

    // Snapshot model used to build a dividend: a holder's eligible amount + leaf index.
    struct Holder {
        address account;
        uint256 index;
        uint256 amount;
    }

    function setUp() public virtual {
        source = new AdminActionSource(admin, true); // autoAttest on for tests
        registry = new CorporateActionRegistry(admin, address(source));
        distributor = new DividendDistributor(address(registry), admin);

        registry.grantRole(registry.DISTRIBUTOR_ROLE(), address(distributor));

        usdg = new MockERC20("USD for Global", "USDG", 18);
        tsla = new MockERC20("Tesla Tokenized Stock", "TSLA", 18);

        registry.setAssetIssuer(address(tsla), issuer);
    }

    /*//////////////////////////////////////////////////////////////
                              LIFECYCLE HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Announce a CASH_DIVIDEND for TSLA as the issuer.
    function _announceDividend(uint256 ratePerShare, uint64 claimDeadline) internal returns (uint256 id) {
        vm.prank(issuer);
        id = registry.announceAction(
            address(tsla),
            ActionType.CASH_DIVIDEND,
            ratePerShare,
            uint64(block.number), // recordBlock = now; advanced before publish
            uint64(block.timestamp), // payableAt = now
            claimDeadline,
            address(usdg),
            "ipfs://tsla-q2-dividend"
        );
    }

    /// @dev Build leaves for the given holders.
    function _leaves(uint256 id, Holder[] memory hs) internal pure returns (bytes32[] memory leaves) {
        leaves = new bytes32[](hs.length);
        for (uint256 i = 0; i < hs.length; i++) {
            leaves[i] = MerkleHelper.leaf(id, hs[i].index, hs[i].account, hs[i].amount);
        }
    }

    /// @dev Publish the root for `id` over `hs` (advances past recordBlock first).
    function _publish(uint256 id, Holder[] memory hs) internal returns (bytes32 root, uint256 total) {
        bytes32[] memory leaves = _leaves(id, hs);
        root = MerkleHelper.getRoot(leaves);
        for (uint256 i = 0; i < hs.length; i++) {
            total += hs[i].amount;
        }
        vm.roll(block.number + 1); // record block now in the past
        vm.prank(issuer);
        registry.publishRoot(id, root, total, hs.length);
    }

    /// @dev Fund `id` fully from the issuer, moving it to CLAIMABLE.
    function _fund(uint256 id, uint256 total) internal {
        usdg.mint(issuer, total);
        vm.startPrank(issuer);
        usdg.approve(address(distributor), total);
        distributor.fund(id, total);
        vm.stopPrank();
    }

    /// @dev One-shot: announce -> publish -> fund a claimable dividend for `hs`.
    function _setupClaimable(uint256 ratePerShare, uint64 claimDeadline, Holder[] memory hs)
        internal
        returns (uint256 id, uint256 total)
    {
        id = _announceDividend(ratePerShare, claimDeadline);
        (, total) = _publish(id, hs);
        _fund(id, total);
    }

    /// @dev Proof for holder at position `pos` within `hs`.
    function _proof(uint256 id, Holder[] memory hs, uint256 pos) internal pure returns (bytes32[] memory) {
        bytes32[] memory leaves = _leaves(id, hs);
        return MerkleHelper.getProof(leaves, pos);
    }

    /// @dev Convenience: the canonical two-holder snapshot (Dina + Leo).
    function _twoHolders(uint256 dinaAmount, uint256 leoAmount) internal view returns (Holder[] memory hs) {
        hs = new Holder[](2);
        hs[0] = Holder({ account: dina, index: 0, amount: dinaAmount });
        hs[1] = Holder({ account: leo, index: 1, amount: leoAmount });
    }
}
