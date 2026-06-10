// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IDividendDistributor } from "../src/interfaces/IDividendDistributor.sol";
import { ActionStatus, ActionType } from "../src/libraries/CorporateActionTypes.sol";
import { BaseTest } from "./Base.t.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

contract DividendDistributorTest is BaseTest {
    /*//////////////////////////////////////////////////////////////
                                  FUND
    //////////////////////////////////////////////////////////////*/

    function test_Fund_PartialThenFull_FlipsClaimable() public {
        uint256 id = _announceDividend(0.5e18, 0);
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18); // total 6e18
        (, uint256 total) = _publish(id, hs);

        usdg.mint(issuer, total);
        vm.startPrank(issuer);
        usdg.approve(address(distributor), total);

        distributor.fund(id, 2e18); // partial
        assertEq(distributor.totalFunded(id), 2e18);
        assertEq(uint8(registry.getAction(id).status), uint8(ActionStatus.ROOT_PUBLISHED));

        distributor.fund(id, 4e18); // completes
        vm.stopPrank();
        assertEq(distributor.totalFunded(id), total);
        assertEq(uint8(registry.getAction(id).status), uint8(ActionStatus.CLAIMABLE));
    }

    function test_Fund_RevertsOverfund() public {
        uint256 id = _announceDividend(0.5e18, 0);
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (, uint256 total) = _publish(id, hs);
        usdg.mint(issuer, total + 1e18);
        vm.startPrank(issuer);
        usdg.approve(address(distributor), total + 1e18);
        vm.expectRevert(abi.encodeWithSelector(IDividendDistributor.Overfunded.selector, id, total + 1, total));
        distributor.fund(id, total + 1);
        vm.stopPrank();
    }

    function test_Fund_RevertsNotPublished() public {
        uint256 id = _announceDividend(0.5e18, 0);
        vm.expectRevert(abi.encodeWithSelector(IDividendDistributor.WrongStatus.selector, id));
        vm.prank(issuer);
        distributor.fund(id, 1e18);
    }

    /*//////////////////////////////////////////////////////////////
                                 CLAIM
    //////////////////////////////////////////////////////////////*/

    function test_Claim_HappyPath_TwoHolders() public {
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (uint256 id, uint256 total) = _setupClaimable(0.5e18, 0, hs);

        // Dina claims her own.
        bytes32[] memory pDina = _proof(id, hs, 0);
        vm.prank(dina);
        distributor.claim(id, 0, dina, 2.5e18, pDina);
        assertEq(usdg.balanceOf(dina), 2.5e18);
        assertTrue(distributor.isClaimed(id, 0));

        // Leo claims his own.
        bytes32[] memory pLeo = _proof(id, hs, 1);
        vm.prank(leo);
        distributor.claim(id, 1, leo, 3.5e18, pLeo);
        assertEq(usdg.balanceOf(leo), 3.5e18);

        assertEq(distributor.totalClaimed(id), total);
        assertEq(usdg.balanceOf(address(distributor)), 0);
    }

    function test_Claim_OnBehalf_FundsGoToAccount() public {
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (uint256 id,) = _setupClaimable(0.5e18, 0, hs);

        bytes32[] memory pDina = _proof(id, hs, 0);
        // Relayer submits, but funds settle to Dina (FR-6).
        vm.prank(relayer);
        distributor.claim(id, 0, dina, 2.5e18, pDina);
        assertEq(usdg.balanceOf(dina), 2.5e18);
        assertEq(usdg.balanceOf(relayer), 0);
    }

    function test_Claim_RevertsDoubleClaim() public {
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (uint256 id,) = _setupClaimable(0.5e18, 0, hs);
        bytes32[] memory pDina = _proof(id, hs, 0);
        vm.prank(dina);
        distributor.claim(id, 0, dina, 2.5e18, pDina);

        vm.expectRevert(abi.encodeWithSelector(IDividendDistributor.AlreadyClaimed.selector, id, 0));
        vm.prank(dina);
        distributor.claim(id, 0, dina, 2.5e18, pDina);
    }

    function test_Claim_RevertsWrongAmount() public {
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (uint256 id,) = _setupClaimable(0.5e18, 0, hs);
        bytes32[] memory pDina = _proof(id, hs, 0);
        // Inflate the amount: leaf no longer matches the proof.
        vm.expectRevert(abi.encodeWithSelector(IDividendDistributor.InvalidProof.selector, id, 0));
        vm.prank(dina);
        distributor.claim(id, 0, dina, 9e18, pDina);
    }

    function test_Claim_RevertsWrongProof() public {
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (uint256 id,) = _setupClaimable(0.5e18, 0, hs);
        // Use Leo's proof to claim Dina's leaf.
        bytes32[] memory pLeo = _proof(id, hs, 1);
        vm.expectRevert(abi.encodeWithSelector(IDividendDistributor.InvalidProof.selector, id, 0));
        vm.prank(dina);
        distributor.claim(id, 0, dina, 2.5e18, pLeo);
    }

    function test_Claim_RevertsBeforePayable() public {
        // Announce with a future payable date.
        vm.prank(issuer);
        uint256 id = registry.announceAction(
            address(tsla),
            ActionType.CASH_DIVIDEND,
            0.5e18,
            uint64(block.number),
            uint64(block.timestamp + 1 days),
            0,
            address(usdg),
            "ipfs://future"
        );
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (, uint256 total) = _publish(id, hs);
        _fund(id, total);

        bytes32[] memory pDina = _proof(id, hs, 0);
        vm.expectRevert(
            abi.encodeWithSelector(IDividendDistributor.NotYetClaimable.selector, id, uint64(block.timestamp + 1 days))
        );
        vm.prank(dina);
        distributor.claim(id, 0, dina, 2.5e18, pDina);
    }

    function test_Claim_RevertsWhenPaused() public {
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (uint256 id,) = _setupClaimable(0.5e18, 0, hs);
        distributor.pause();
        bytes32[] memory pDina = _proof(id, hs, 0);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(dina);
        distributor.claim(id, 0, dina, 2.5e18, pDina);
    }

    function test_Claim_GasUnderTarget() public {
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (uint256 id,) = _setupClaimable(0.5e18, 0, hs);
        bytes32[] memory pDina = _proof(id, hs, 0);
        vm.prank(dina);
        uint256 g = gasleft();
        distributor.claim(id, 0, dina, 2.5e18, pDina);
        uint256 used = g - gasleft();
        emit log_named_uint("claim gas used", used);
        // Generous ceiling; the precise figure is reported by `forge test --gas-report`.
        assertLt(used, 150_000);
    }

    /*//////////////////////////////////////////////////////////////
                                 SWEEP
    //////////////////////////////////////////////////////////////*/

    function test_Sweep_RevertsBeforeDeadline() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (uint256 id,) = _setupClaimable(0.5e18, deadline, hs);
        vm.expectRevert(abi.encodeWithSelector(IDividendDistributor.SweepNotAllowed.selector, id, deadline));
        vm.prank(issuer);
        distributor.sweepUnclaimed(id);
    }

    function test_Sweep_AfterDeadline_ReturnsRemainder() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (uint256 id, uint256 total) = _setupClaimable(0.5e18, deadline, hs);

        // Only Dina claims; Leo's 3.5e18 stays unclaimed.
        bytes32[] memory pDina = _proof(id, hs, 0);
        vm.prank(dina);
        distributor.claim(id, 0, dina, 2.5e18, pDina);

        vm.warp(deadline + 1);
        uint256 before = usdg.balanceOf(issuer);
        vm.prank(issuer);
        distributor.sweepUnclaimed(id);

        assertEq(usdg.balanceOf(issuer) - before, total - 2.5e18); // 3.5e18 returned
        assertEq(uint8(registry.getAction(id).status), uint8(ActionStatus.FINALIZED));
        assertEq(usdg.balanceOf(address(distributor)), 0);
    }

    function test_Sweep_RevertsNonIssuer() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (uint256 id,) = _setupClaimable(0.5e18, deadline, hs);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(IDividendDistributor.Unauthorized.selector, attacker, id));
        vm.prank(attacker);
        distributor.sweepUnclaimed(id);
    }

    function test_Claim_RevertsAfterSweepFinalized() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        Holder[] memory hs = _twoHolders(2.5e18, 3.5e18);
        (uint256 id,) = _setupClaimable(0.5e18, deadline, hs);
        vm.warp(deadline + 1);
        vm.prank(issuer);
        distributor.sweepUnclaimed(id);

        // Leo can no longer claim — action is FINALIZED.
        bytes32[] memory pLeo = _proof(id, hs, 1);
        vm.expectRevert(abi.encodeWithSelector(IDividendDistributor.WrongStatus.selector, id));
        vm.prank(leo);
        distributor.claim(id, 1, leo, 3.5e18, pLeo);
    }
}
