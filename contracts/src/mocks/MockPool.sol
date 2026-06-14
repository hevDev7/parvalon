// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockPool
/// @author Parvalon
/// @notice DEMO-ONLY fixed-rate swap (USDG -> stock) backing the optional
///         "claim & reinvest" stretch flow (FR-14). It is NOT an AMM and has no
///         price discovery, slippage, or liquidity guarantees. Clearly labeled as
///         demo surface so judges are never misled.
/// @dev `priceE18` = stock units returned per 1 USDG (scaled 1e18). The pool must
///      be pre-seeded with the stock token.
contract MockPool {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDG;
    IERC20 public immutable STOCK;
    uint256 public immutable PRICE_E18;

    event Swapped(address indexed user, uint256 usdgIn, uint256 stockOut);

    constructor(address usdg, address stock, uint256 priceE18) {
        require(usdg != address(0) && stock != address(0) && priceE18 != 0, "bad args");
        USDG = IERC20(usdg);
        STOCK = IERC20(stock);
        PRICE_E18 = priceE18;
    }

    /// @notice Swap `usdgIn` USDG for stock at the fixed demo rate. Caller must approve.
    function swap(uint256 usdgIn) external returns (uint256 stockOut) {
        stockOut = (usdgIn * PRICE_E18) / 1e18;
        USDG.safeTransferFrom(msg.sender, address(this), usdgIn);
        STOCK.safeTransfer(msg.sender, stockOut);
        emit Swapped(msg.sender, usdgIn, stockOut);
    }
}
