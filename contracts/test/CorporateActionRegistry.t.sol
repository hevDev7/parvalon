// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ICorporateActionRegistry } from "../src/interfaces/ICorporateActionRegistry.sol";
import { ActionStatus, ActionType, CorporateAction } from "../src/libraries/CorporateActionTypes.sol";
import { BaseTest } from "./Base.t.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

contract CorporateActionRegistryTest is BaseTest {
    /*//////////////////////////////////////////////////////////////
                                ANNOUNCE
    //////////////////////////////////////////////////////////////*/

    function test_Announce_RecordsAndEmits() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit ICorporateActionRegistry.ActionAnnounced(
            1,
            address(tsla),
            ActionType.CASH_DIVIDEND,
            0.5e18,
            uint64(block.number),
            uint64(block.timestamp),
            uint64(block.timestamp + 7 days),
            address(usdg),
            "ipfs://tsla-q2-dividend"
        );
        uint256 id = _announceDividend(0.5e18, uint64(block.timestamp + 7 days));

        assertEq(id, 1);
        assertEq(registry.actionCount(), 1);
        CorporateAction memory a = registry.getAction(1);
        assertEq(a.asset, address(tsla));
        assertEq(a.ratePerShare, 0.5e18);
        assertEq(a.payoutToken, address(usdg));
        assertEq(uint8(a.status), uint8(ActionStatus.ANNOUNCED));
        assertEq(a.merkleRoot, bytes32(0));
        assertEq(a.totalPayout, 0);
    }

    function test_Announce_RevertsForNonIssuer() public {
        vm.expectRevert(abi.encodeWithSelector(ICorporateActionRegistry.Unauthorized.selector, attacker, address(tsla)));
        vm.prank(attacker);
        registry.announceAction(
            address(tsla),
            ActionType.CASH_DIVIDEND,
            0.5e18,
            uint64(block.number),
            uint64(block.timestamp),
            0,
            address(usdg),
            "x"
        );
    }

    function test_Announce_RevertsZeroRate() public {
        vm.expectRevert(abi.encodeWithSelector(ICorporateActionRegistry.InvalidParams.selector, "ratePerShare=0"));
        vm.prank(issuer);
        registry.announceAction(
            address(tsla),
            ActionType.CASH_DIVIDEND,
            0,
            uint64(block.number),
            uint64(block.timestamp),
            0,
            address(usdg),
            "x"
        );
    }

    function test_Announce_RevertsBadDeadline() public {
        uint64 payable_ = uint64(block.timestamp + 10);
        vm.expectRevert(
            abi.encodeWithSelector(ICorporateActionRegistry.InvalidParams.selector, "claimDeadline<=payableAt")
        );
        vm.prank(issuer);
        registry.announceAction(
            address(tsla), ActionType.CASH_DIVIDEND, 1e18, uint64(block.number), payable_, payable_, address(usdg), "x"
        );
    }

    function test_Announce_Informational_Split() public {
        registry.setAssetIssuer(address(tsla), issuer);
        vm.prank(issuer);
        uint256 id = registry.announceAction(
            address(tsla), ActionType.STOCK_SPLIT, 0, uint64(block.number), 0, 0, address(0), "ipfs://4-for-1"
        );
        CorporateAction memory a = registry.getAction(id);
        assertEq(uint8(a.actionType), uint8(ActionType.STOCK_SPLIT));
        assertEq(a.payoutToken, address(0));
        assertEq(uint8(a.status), uint8(ActionStatus.ANNOUNCED));
    }

    function test_Announce_RevertsInformationalWithRate() public {
        vm.expectRevert(
            abi.encodeWithSelector(ICorporateActionRegistry.InvalidParams.selector, "ratePerShare!=0 for informational")
        );
        vm.prank(issuer);
        registry.announceAction(
            address(tsla), ActionType.STOCK_SPLIT, 1e18, uint64(block.number), 0, 0, address(0), "x"
        );
    }

    /*//////////////////////////////////////////////////////////////
                              PUBLISH ROOT
    //////////////////////////////////////////////////////////////*/

    function test_PublishRoot_HappyPath() public {
        uint256 id = _announceDividend(0.5e18, 0);
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        (bytes32 root, uint256 total) = _publish(id, hs);

        CorporateAction memory a = registry.getAction(id);
        assertEq(a.merkleRoot, root);
        assertEq(a.totalPayout, total);
        assertEq(uint8(a.status), uint8(ActionStatus.ROOT_PUBLISHED));
    }

    function test_PublishRoot_RevertsBeforeRecord() public {
        uint256 id = _announceDividend(0.5e18, 0);
        // do NOT advance the block: block.number == recordBlock
        vm.expectRevert(
            abi.encodeWithSelector(
                ICorporateActionRegistry.RecordNotTaken.selector, id, uint64(block.number), block.number
            )
        );
        vm.prank(issuer);
        registry.publishRoot(id, keccak256("r"), 1e18, 1);
    }

    function test_PublishRoot_RevertsNonIssuer() public {
        uint256 id = _announceDividend(0.5e18, 0);
        vm.roll(block.number + 1);
        vm.expectRevert(abi.encodeWithSelector(ICorporateActionRegistry.Unauthorized.selector, attacker, address(tsla)));
        vm.prank(attacker);
        registry.publishRoot(id, keccak256("r"), 1e18, 1);
    }

    function test_PublishRoot_RevertsTwice() public {
        uint256 id = _announceDividend(0.5e18, 0);
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        _publish(id, hs);
        vm.roll(block.number + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ICorporateActionRegistry.InvalidStatus.selector, id, ActionStatus.ROOT_PUBLISHED, ActionStatus.ANNOUNCED
            )
        );
        vm.prank(issuer);
        registry.publishRoot(id, keccak256("r2"), 1e18, 1);
    }

    /*//////////////////////////////////////////////////////////////
                                 CANCEL
    //////////////////////////////////////////////////////////////*/

    function test_Cancel_HappyPath() public {
        uint256 id = _announceDividend(0.5e18, 0);
        vm.prank(issuer);
        registry.cancelAction(id);
        assertEq(uint8(registry.getAction(id).status), uint8(ActionStatus.CANCELLED));
    }

    function test_Cancel_RevertsAfterClaimable() public {
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        (uint256 id,) = _setupClaimable(0.5e18, 0, hs);
        vm.expectRevert(
            abi.encodeWithSelector(
                ICorporateActionRegistry.InvalidStatus.selector, id, ActionStatus.CLAIMABLE, ActionStatus.ANNOUNCED
            )
        );
        vm.prank(issuer);
        registry.cancelAction(id);
    }

    /*//////////////////////////////////////////////////////////////
                           ACCESS / LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    function test_MarkClaimable_RevertsForNonDistributor() public {
        uint256 id = _announceDividend(0.5e18, 0);
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        _publish(id, hs);
        vm.expectRevert(abi.encodeWithSelector(ICorporateActionRegistry.NotDistributor.selector, attacker));
        vm.prank(attacker);
        registry.markClaimable(id);
    }

    function test_SetAssetIssuer_OnlyAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, bytes32(0))
        );
        vm.prank(attacker);
        registry.setAssetIssuer(address(tsla), attacker);
    }

    function test_SetActionSource() public {
        address newSource = makeAddr("newSource");
        vm.expectEmit(true, true, false, false, address(registry));
        emit ICorporateActionRegistry.ActionSourceUpdated(address(source), newSource);
        registry.setActionSource(newSource);
        assertEq(registry.actionSource(), newSource);
    }

    /*//////////////////////////////////////////////////////////////
                                 PAUSE
    //////////////////////////////////////////////////////////////*/

    function test_Pause_BlocksAnnounce() public {
        registry.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(issuer);
        registry.announceAction(
            address(tsla),
            ActionType.CASH_DIVIDEND,
            1e18,
            uint64(block.number),
            uint64(block.timestamp),
            0,
            address(usdg),
            "x"
        );
    }

    function test_GetAction_RevertsNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(ICorporateActionRegistry.ActionNotFound.selector, 99));
        registry.getAction(99);
    }
}
