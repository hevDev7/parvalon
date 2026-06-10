// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title SplitAdjuster
/// @author CorporaX
/// @notice Math integrators (lending markets, AMMs, oracles) use to react to a
///         `STOCK_SPLIT` corporate action. CorporaX emits splits as *informational*
///         signals (it never rebases a token it doesn't control); this library is
///         how a protocol turns that signal into a correct price/quantity adjustment.
///
/// @dev A split is expressed as a ratio `newShares : oldShares`:
///        - forward 4-for-1  → SplitRatio(4, 1)  (price ÷4, quantity ×4)
///        - reverse 1-for-10 → SplitRatio(1, 10) (price ×10, quantity ÷10)
///      Value (`price × quantity`) is conserved up to integer rounding. All math
///      uses {Math.mulDiv} for full-width precision.
library SplitAdjuster {
    struct SplitRatio {
        uint256 newShares; // numerator
        uint256 oldShares; // denominator
    }

    error InvalidRatio();

    /// @notice Adjust a per-share price across a split (price ÷ ratio).
    function adjustPrice(uint256 price, SplitRatio memory r) internal pure returns (uint256) {
        _check(r);
        return Math.mulDiv(price, r.oldShares, r.newShares);
    }

    /// @notice Adjust a share quantity across a split (quantity × ratio).
    function adjustQuantity(uint256 quantity, SplitRatio memory r) internal pure returns (uint256) {
        _check(r);
        return Math.mulDiv(quantity, r.newShares, r.oldShares);
    }

    /// @notice Adjust a collateral factor's *effective* valuation: equivalent to
    ///         re-pricing the underlying. Convenience alias for {adjustPrice}.
    function adjustValuation(uint256 valuePerShare, SplitRatio memory r) internal pure returns (uint256) {
        return adjustPrice(valuePerShare, r);
    }

    /// @notice True when the ratio is a forward split (more shares after).
    function isForward(SplitRatio memory r) internal pure returns (bool) {
        _check(r);
        return r.newShares > r.oldShares;
    }

    function _check(SplitRatio memory r) private pure {
        if (r.newShares == 0 || r.oldShares == 0) revert InvalidRatio();
    }
}
