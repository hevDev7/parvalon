// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { SplitAwareCollateral } from "../src/examples/SplitAwareCollateral.sol";
import { ActionType } from "../src/libraries/CorporateActionTypes.sol";
import { SplitAdjuster } from "../src/libraries/SplitAdjuster.sol";
import { BaseTest } from "./Base.t.sol";

/// @dev External wrapper so {vm.expectRevert} can observe internal-library reverts.
contract SplitAdjusterHarness {
    function adjustPrice(uint256 p, SplitAdjuster.SplitRatio memory r) external pure returns (uint256) {
        return SplitAdjuster.adjustPrice(p, r);
    }
}

contract SplitAdjusterTest is BaseTest {
    SplitAwareCollateral internal market;
    SplitAdjusterHarness internal harness;
    address internal keeper = makeAddr("keeper");

    function setUp() public override {
        super.setUp();
        market = new SplitAwareCollateral(address(registry), keeper);
        harness = new SplitAdjusterHarness();
    }

    /*//////////////////////////////////////////////////////////////
                                 LIBRARY
    //////////////////////////////////////////////////////////////*/

    function test_ForwardSplit_4for1() public pure {
        SplitAdjuster.SplitRatio memory r = SplitAdjuster.SplitRatio(4, 1);
        assertEq(SplitAdjuster.adjustPrice(100e18, r), 25e18);
        assertEq(SplitAdjuster.adjustQuantity(10e18, r), 40e18);
        assertTrue(SplitAdjuster.isForward(r));
    }

    function test_ReverseSplit_1for10() public pure {
        SplitAdjuster.SplitRatio memory r = SplitAdjuster.SplitRatio(1, 10);
        assertEq(SplitAdjuster.adjustPrice(100e18, r), 1000e18);
        assertEq(SplitAdjuster.adjustQuantity(100e18, r), 10e18);
        assertFalse(SplitAdjuster.isForward(r));
    }

    function test_RevertsZeroRatio() public {
        SplitAdjuster.SplitRatio memory r = SplitAdjuster.SplitRatio(0, 1);
        vm.expectRevert(SplitAdjuster.InvalidRatio.selector);
        harness.adjustPrice(1e18, r); // external call so expectRevert observes it
    }

    /// @notice Value (price × quantity) is conserved across a split, up to rounding.
    ///         Bounded to substantial values so the two integer divisions are
    ///         negligible; asserted with a relative (0.1%) tolerance.
    function testFuzz_ValueConservation(uint256 price, uint256 qty, uint16 n, uint16 d) public pure {
        price = bound(price, 1e18, 1e27);
        qty = bound(qty, 1e18, 1e27);
        uint256 num = bound(uint256(n), 1, 1000);
        uint256 den = bound(uint256(d), 1, 1000);
        SplitAdjuster.SplitRatio memory r = SplitAdjuster.SplitRatio(num, den);

        uint256 before = price * qty / 1e18;
        uint256 afterValue = SplitAdjuster.adjustPrice(price, r) * SplitAdjuster.adjustQuantity(qty, r) / 1e18;

        assertApproxEqRel(afterValue, before, 1e15); // within 0.1%
    }

    /*//////////////////////////////////////////////////////////////
                            EXAMPLE INTEGRATION
    //////////////////////////////////////////////////////////////*/

    function _announceSplit() internal returns (uint256 id) {
        vm.prank(issuer);
        id = registry.announceAction(
            address(tsla), ActionType.STOCK_SPLIT, 0, uint64(block.number), 0, 0, address(0), "ipfs://4-for-1"
        );
    }

    function test_Market_AppliesSplitToPrice() public {
        uint256 id = _announceSplit();
        vm.startPrank(keeper);
        market.setPrice(address(tsla), 100e18);
        market.applySplit(id, 4, 1); // 4-for-1
        vm.stopPrank();
        assertEq(market.price(address(tsla)), 25e18);
        assertTrue(market.applied(id));
    }

    function test_Market_RevertsDoubleApply() public {
        uint256 id = _announceSplit();
        vm.startPrank(keeper);
        market.setPrice(address(tsla), 100e18);
        market.applySplit(id, 4, 1);
        vm.expectRevert(abi.encodeWithSelector(SplitAwareCollateral.AlreadyApplied.selector, id));
        market.applySplit(id, 4, 1);
        vm.stopPrank();
    }

    function test_Market_RevertsNonSplitAction() public {
        // A cash dividend is not a split.
        uint256 id = _announceDividend(0.5e18, 0);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(SplitAwareCollateral.NotASplit.selector, id));
        market.applySplit(id, 4, 1);
    }

    function test_Market_RevertsNonKeeper() public {
        uint256 id = _announceSplit();
        vm.expectRevert(SplitAwareCollateral.NotKeeper.selector);
        market.applySplit(id, 4, 1);
    }
}
