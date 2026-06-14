// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ICorporateActionRegistry } from "../src/interfaces/ICorporateActionRegistry.sol";
import { ActionStatus, ActionType } from "../src/libraries/CorporateActionTypes.sol";
import { MockArbSys } from "../src/mocks/MockArbSys.sol";
import { BaseTest } from "./Base.t.sol";
import { MerkleHelper } from "./utils/MerkleHelper.sol";

/// @notice Regression for the Orbit record-date bug: on Arbitrum/Orbit the EVM
///         `block.number` is the L1 block number, but the snapshot tooling keys on
///         the L2 block number. The registry must compare `recordBlock` against the
///         L2 number via ArbSys.arbBlockNumber() so publishRoot stays satisfiable.
contract OrbitRecordBlockTest is BaseTest {
    address constant ARB_SYS = 0x0000000000000000000000000000000000000064;

    function _installArbSys(uint256 l2Block) internal {
        MockArbSys mock = new MockArbSys();
        vm.etch(ARB_SYS, address(mock).code);
        MockArbSys(ARB_SYS).setBlock(l2Block); // writes storage slot 0 at 0x64
    }

    function _announceWithRecordBlock(uint64 recordBlock) internal returns (uint256 id) {
        vm.prank(issuer);
        id = registry.announceAction(
            address(tsla),
            ActionType.CASH_DIVIDEND,
            0.5e18,
            recordBlock,
            uint64(block.timestamp),
            0,
            address(usdg),
            "ipfs://x"
        );
    }

    /// @dev recordBlock sits ABOVE block.number but BELOW the L2 (ArbSys) block —
    ///      the exact L1-vs-L2 gap that bricked live action 4. With the fix the guard
    ///      reads ArbSys and publishRoot succeeds.
    function test_PublishRoot_UsesArbBlockNumber_OnOrbit() public {
        _installArbSys(1_000_000);
        uint64 recordBlock = uint64(block.number + 500); // > block.number, < 1_000_000
        uint256 id = _announceWithRecordBlock(recordBlock);

        Holder[] memory hs = _twoHolders(5e18, 7e18);
        bytes32 root = MerkleHelper.getRoot(_leaves(id, hs));

        vm.prank(issuer);
        registry.publishRoot(id, root, 12e18, hs.length); // must NOT revert
        assertEq(uint8(registry.getAction(id).status), uint8(ActionStatus.ROOT_PUBLISHED));
    }

    /// @dev When the L2 block is still at/below recordBlock, the guard still fires
    ///      and reports the L2 (ArbSys) number as the current block.
    function test_PublishRoot_RevertsWhenArbBlockNotPast() public {
        _installArbSys(100);
        uint256 id = _announceWithRecordBlock(500);
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        bytes32 root = MerkleHelper.getRoot(_leaves(id, hs));

        vm.expectRevert(abi.encodeWithSelector(ICorporateActionRegistry.RecordNotTaken.selector, id, 500, 100));
        vm.prank(issuer);
        registry.publishRoot(id, root, 12e18, hs.length);
    }

    /// @dev Without the precompile (local/anvil), the guard falls back to block.number.
    function test_PublishRoot_FallsBackToBlockNumber_NoArbSys() public {
        // ARB_SYS has no code here. recordBlock just below block.number -> succeeds.
        vm.roll(block.number + 10);
        uint256 id = _announceWithRecordBlock(uint64(block.number - 1));
        Holder[] memory hs = _twoHolders(5e18, 7e18);
        bytes32 root = MerkleHelper.getRoot(_leaves(id, hs));
        vm.prank(issuer);
        registry.publishRoot(id, root, 12e18, hs.length);
        assertEq(uint8(registry.getAction(id).status), uint8(ActionStatus.ROOT_PUBLISHED));
    }
}
