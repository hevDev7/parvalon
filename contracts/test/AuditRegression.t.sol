// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ICorporateActionRegistry } from "../src/interfaces/ICorporateActionRegistry.sol";
import { IDividendDistributor } from "../src/interfaces/IDividendDistributor.sol";
import { ActionStatus, ActionType } from "../src/libraries/CorporateActionTypes.sol";
import { MockFeeOnTransferERC20 } from "../src/mocks/MockFeeOnTransferERC20.sol";
import { BaseTest } from "./Base.t.sol";
import { MerkleHelper } from "./utils/MerkleHelper.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Regression tests for the audit findings (#1 cross-action drain, #2 cancel
///         fund-lock, #3 sweep pause, #4 fee-on-transfer accounting).
contract AuditRegressionTest is BaseTest {
    /*//////////////////////////////////////////////////////////////
        #1 — claim cannot drain funds belonging to another action
    //////////////////////////////////////////////////////////////*/

    function test_Audit1_ClaimCannotDrainSiblingAction() public {
        // Action B (id 1): honestly funded with 12 USDG, CLAIMABLE.
        Holder[] memory hsB = _twoHolders(5e18, 7e18);
        (uint256 idB, uint256 totalB) = _setupClaimable(0.5e18, 0, hsB);
        assertEq(usdg.balanceOf(address(distributor)), totalB); // 12e18 pooled

        // Action A (id 2): malicious root — a single leaf claiming 12e18 — but the
        // issuer funds only 1 wei (totalPayout = 1).
        uint256 idA = _announceDividend(0.5e18, 0);
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = MerkleHelper.leaf(idA, 0, attacker, 12e18);
        bytes32 root = MerkleHelper.getRoot(leaves);
        vm.roll(block.number + 1);
        vm.prank(issuer);
        registry.publishRoot(idA, root, 1, 1); // totalPayout = 1 wei
        usdg.mint(issuer, 1);
        vm.startPrank(issuer);
        usdg.approve(address(distributor), 1);
        distributor.fund(idA, 1); // CLAIMABLE with only 1 wei funded
        vm.stopPrank();

        // The over-claim is rejected by the per-action solvency cap.
        bytes32[] memory proof = MerkleHelper.getProof(leaves, 0);
        vm.expectRevert(abi.encodeWithSelector(IDividendDistributor.ExceedsFunded.selector, idA, 12e18, 1));
        vm.prank(attacker);
        distributor.claim(idA, 0, attacker, 12e18, proof);

        // Action B's funds are untouched and its holders can still claim in full.
        assertEq(usdg.balanceOf(address(distributor)), totalB + 1);
        bytes32[] memory pDina = _proof(idB, hsB, 0);
        vm.prank(dina);
        distributor.claim(idB, 0, dina, 5e18, pDina);
        assertEq(usdg.balanceOf(dina), 5e18);
    }

    /*//////////////////////////////////////////////////////////////
        #2 — a partially-funded action cannot be cancelled (no lock)
    //////////////////////////////////////////////////////////////*/

    function test_Audit2_CannotCancelPartiallyFundedAction() public {
        uint256 id = _announceDividend(0.5e18, uint64(block.timestamp + 7 days));
        Holder[] memory hs = _twoHolders(5e18, 7e18); // total 12e18
        (, uint256 total) = _publish(id, hs);

        // Partially fund (status stays ROOT_PUBLISHED).
        usdg.mint(issuer, total);
        vm.startPrank(issuer);
        usdg.approve(address(distributor), total);
        distributor.fund(id, 6e18);
        // Cancellation is now blocked — funds can never be stranded.
        vm.expectRevert(
            abi.encodeWithSelector(
                ICorporateActionRegistry.InvalidStatus.selector, id, ActionStatus.ROOT_PUBLISHED, ActionStatus.ANNOUNCED
            )
        );
        registry.cancelAction(id);

        // Recovery path intact: finish funding, then sweep after the deadline.
        distributor.fund(id, 6e18); // now CLAIMABLE
        vm.stopPrank();
        assertEq(uint8(registry.getAction(id).status), uint8(ActionStatus.CLAIMABLE));

        vm.warp(block.timestamp + 7 days + 1);
        uint256 before = usdg.balanceOf(issuer);
        vm.prank(issuer);
        distributor.sweepUnclaimed(id);
        assertEq(usdg.balanceOf(issuer) - before, total); // all funds recovered
    }

    function test_Audit2_CancelStillWorksWhenAnnounced() public {
        uint256 id = _announceDividend(0.5e18, 0);
        vm.prank(issuer);
        registry.cancelAction(id);
        assertEq(uint8(registry.getAction(id).status), uint8(ActionStatus.CANCELLED));
    }

    /*//////////////////////////////////////////////////////////////
        #3 — sweepUnclaimed respects the emergency pause
    //////////////////////////////////////////////////////////////*/

    function test_Audit3_SweepBlockedWhilePaused() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        (uint256 id,) = _setupClaimable(0.5e18, deadline, hs);
        vm.warp(deadline + 1);

        distributor.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(issuer);
        distributor.sweepUnclaimed(id);

        // After unpause it works again.
        distributor.unpause();
        vm.prank(issuer);
        distributor.sweepUnclaimed(id);
        assertEq(uint8(registry.getAction(id).status), uint8(ActionStatus.FINALIZED));
    }

    /*//////////////////////////////////////////////////////////////
        #4 — fund credits the received balance, not the requested amount
    //////////////////////////////////////////////////////////////*/

    function test_Audit4_FeeOnTransferCreditsReceivedAmount() public {
        MockFeeOnTransferERC20 feeToken = new MockFeeOnTransferERC20("Fee USDG", "fUSDG", 100); // 1% fee

        // Announce a dividend paid in the fee token; one holder owed 99 (the net).
        vm.prank(issuer);
        uint256 id = registry.announceAction(
            address(tsla),
            ActionType.CASH_DIVIDEND,
            0.5e18,
            uint64(block.number),
            uint64(block.timestamp),
            0,
            address(feeToken),
            "ipfs://fee"
        );
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = MerkleHelper.leaf(id, 0, dina, 99e18);
        bytes32 root = MerkleHelper.getRoot(leaves);
        vm.roll(block.number + 1);
        vm.prank(issuer);
        registry.publishRoot(id, root, 99e18, 1); // target = net received

        // Fund 100; 1% fee → distributor receives 99 → reaches target exactly.
        feeToken.mint(issuer, 100e18);
        vm.startPrank(issuer);
        feeToken.approve(address(distributor), 100e18);
        distributor.fund(id, 100e18);
        vm.stopPrank();

        assertEq(distributor.totalFunded(id), 99e18); // credited the RECEIVED amount
        assertEq(feeToken.balanceOf(address(distributor)), 99e18);
        assertEq(uint8(registry.getAction(id).status), uint8(ActionStatus.CLAIMABLE));

        // The holder can claim the full funded amount; nothing is short.
        bytes32[] memory proof = MerkleHelper.getProof(leaves, 0);
        vm.prank(dina);
        distributor.claim(id, 0, dina, 99e18, proof);
        assertEq(feeToken.balanceOf(dina), 99e18 - (99e18 * 100 / 10_000)); // minus the claim-transfer fee
        assertEq(feeToken.balanceOf(address(distributor)), 0);
    }
}
