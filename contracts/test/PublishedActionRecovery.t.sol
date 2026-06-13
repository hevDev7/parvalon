// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CorporateActionRegistry } from "../src/CorporateActionRegistry.sol";
import { ICorporateActionRegistry } from "../src/interfaces/ICorporateActionRegistry.sol";
import { IDividendDistributor } from "../src/interfaces/IDividendDistributor.sol";
import { ActionStatus } from "../src/libraries/CorporateActionTypes.sol";
import { BaseTest } from "./Base.t.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Regression for audit finding #5 — partial funding of a ROOT_PUBLISHED action
///         that never reaches `totalPayout` previously had no exit (claim & sweep both
///         require CLAIMABLE), permanently locking issuer capital. `cancelPublishedAction`
///         is the safe recovery: no claim can occur before CLAIMABLE, so `_funded[id]` is
///         fully recoverable and the action moves to the terminal CANCELLED state.
contract PublishedActionRecoveryTest is BaseTest {
    /// @dev Partially fund a published action, then recover the deposit via cancel.
    function test_CancelPublished_RefundsPartialFundingToIssuer() public {
        uint256 id = _announceDividend(0.5e18, 0);
        Holder[] memory hs = _twoHolders(5e18, 7e18); // totalPayout = 12e18
        (, uint256 total) = _publish(id, hs);

        // Issuer deposits only part of the target; status stays ROOT_PUBLISHED.
        usdg.mint(issuer, total);
        vm.startPrank(issuer);
        usdg.approve(address(distributor), total);
        distributor.fund(id, 6e18);
        vm.stopPrank();
        assertEq(distributor.totalFunded(id), 6e18);
        assertEq(usdg.balanceOf(address(distributor)), 6e18);

        // Recover: the partial deposit is returned and the action is cancelled.
        uint256 before = usdg.balanceOf(issuer);
        vm.prank(issuer);
        distributor.cancelPublishedAction(id);

        assertEq(usdg.balanceOf(issuer) - before, 6e18, "issuer refunded");
        assertEq(usdg.balanceOf(address(distributor)), 0, "distributor drained");
        assertEq(distributor.totalFunded(id), 0, "funded accounting zeroed");
        assertEq(uint8(registry.getAction(id).status), uint8(ActionStatus.CANCELLED), "status CANCELLED");
    }

    /// @dev A published-but-unfunded action can also be cancelled (no transfer).
    function test_CancelPublished_WorksWithZeroFunding() public {
        uint256 id = _announceDividend(0.5e18, 0);
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        _publish(id, hs);

        uint256 before = usdg.balanceOf(issuer);
        vm.prank(issuer);
        distributor.cancelPublishedAction(id);

        assertEq(usdg.balanceOf(issuer), before, "no refund when nothing was funded");
        assertEq(uint8(registry.getAction(id).status), uint8(ActionStatus.CANCELLED));
    }

    /// @dev Emits the recovery event with the exact refunded amount.
    function test_CancelPublished_EmitsEvent() public {
        uint256 id = _announceDividend(0.5e18, 0);
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        (, uint256 total) = _publish(id, hs);
        usdg.mint(issuer, total);
        vm.startPrank(issuer);
        usdg.approve(address(distributor), total);
        distributor.fund(id, 6e18);
        vm.expectEmit(true, true, false, true, address(distributor));
        emit IDividendDistributor.PublishedActionCancelled(id, issuer, 6e18);
        distributor.cancelPublishedAction(id);
        vm.stopPrank();
    }

    /// @dev Only the asset issuer may recover.
    function test_CancelPublished_OnlyIssuer() public {
        uint256 id = _announceDividend(0.5e18, 0);
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        _publish(id, hs);

        vm.expectRevert(abi.encodeWithSelector(IDividendDistributor.Unauthorized.selector, attacker, id));
        vm.prank(attacker);
        distributor.cancelPublishedAction(id);
    }

    /// @dev Cannot recover before publishing (ANNOUNCED) — use registry.cancelAction there.
    function test_CancelPublished_RevertsWhenAnnounced() public {
        uint256 id = _announceDividend(0.5e18, 0);
        vm.expectRevert(abi.encodeWithSelector(IDividendDistributor.WrongStatus.selector, id));
        vm.prank(issuer);
        distributor.cancelPublishedAction(id);
    }

    /// @dev Cannot recover once CLAIMABLE — claims may have moved funds to holders.
    function test_CancelPublished_RevertsWhenClaimable() public {
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        (uint256 id,) = _setupClaimable(0.5e18, 0, hs); // now CLAIMABLE
        vm.expectRevert(abi.encodeWithSelector(IDividendDistributor.WrongStatus.selector, id));
        vm.prank(issuer);
        distributor.cancelPublishedAction(id);
    }

    /// @dev Respects the emergency pause, consistent with fund/claim/sweep.
    function test_CancelPublished_BlockedWhilePaused() public {
        uint256 id = _announceDividend(0.5e18, 0);
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        _publish(id, hs);

        distributor.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(issuer);
        distributor.cancelPublishedAction(id);
    }

    /// @dev The registry transition is distributor-gated: an issuer cannot call it directly.
    function test_RegistryCancelPublished_OnlyDistributor() public {
        uint256 id = _announceDividend(0.5e18, 0);
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        _publish(id, hs);

        vm.expectRevert(abi.encodeWithSelector(ICorporateActionRegistry.NotDistributor.selector, issuer));
        vm.prank(issuer);
        registry.cancelPublishedAction(id);
    }

    /// @dev After recovery the issuer can re-announce and run a fresh action for the asset.
    function test_CancelPublished_AllowsReannouncement() public {
        uint256 id = _announceDividend(0.5e18, 0);
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        _publish(id, hs);
        vm.prank(issuer);
        distributor.cancelPublishedAction(id);

        // A new, independent action settles normally end-to-end.
        Holder[] memory hs2 = _twoHolders(2e18, 3e18);
        (uint256 id2, uint256 total2) = _setupClaimable(0.5e18, 0, hs2);
        assertEq(uint8(registry.getAction(id2).status), uint8(ActionStatus.CLAIMABLE));
        assertEq(usdg.balanceOf(address(distributor)), total2);
    }
}
