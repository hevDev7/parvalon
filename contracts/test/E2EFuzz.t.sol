// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseTest } from "./Base.t.sol";
import { MerkleHelper } from "./utils/MerkleHelper.sol";

/// @notice Fuzzes the full announce->publish->fund->claim cycle across a variable
///         number of holders with random amounts, asserting exact conservation of
///         funds and that every holder can claim exactly once.
contract E2EFuzzTest is BaseTest {
    function testFuzz_FullCycle_NHolders(uint8 nRaw, uint256 amountSeed) public {
        uint256 n = bound(uint256(nRaw), 2, 60);

        Holder[] memory hs = new Holder[](n);
        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            uint256 amt = bound(uint256(keccak256(abi.encode(amountSeed, i))), 1, 1000e18);
            hs[i] = Holder({
                account: address(uint160(uint256(keccak256(abi.encode("holder", i))))), index: i, amount: amt
            });
            total += amt;
        }

        uint256 id = _announceDividend(0.5e18, 0);
        (, uint256 published) = _publish(id, hs);
        assertEq(published, total, "totalPayout mismatch");
        _fund(id, total);

        bytes32[] memory leaves = _leaves(id, hs);
        for (uint256 i = 0; i < n; i++) {
            bytes32[] memory proof = MerkleHelper.getProof(leaves, i);
            distributor.claim(id, hs[i].index, hs[i].account, hs[i].amount, proof);
            assertEq(usdg.balanceOf(hs[i].account), hs[i].amount, "wrong payout");
            assertTrue(distributor.isClaimed(id, i));
        }

        // Conservation: everything funded was claimed; nothing stuck.
        assertEq(distributor.totalClaimed(id), total);
        assertEq(usdg.balanceOf(address(distributor)), 0);
    }

    /// @notice Root determinism: building the tree twice yields the same root.
    function testFuzz_RootDeterminism(uint256 amountSeed) public {
        Holder[] memory hs = new Holder[](5);
        for (uint256 i = 0; i < 5; i++) {
            hs[i] = Holder({
                account: address(uint160(i + 1)),
                index: i,
                amount: bound(uint256(keccak256(abi.encode(amountSeed, i))), 1, 1e24)
            });
        }
        bytes32 r1 = MerkleHelper.getRoot(_leaves(1, hs));
        bytes32 r2 = MerkleHelper.getRoot(_leaves(1, hs));
        assertEq(r1, r2);
    }
}
