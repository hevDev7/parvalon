// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockFeeOnTransferERC20
/// @notice Test token that burns a fee on every transfer (recipient receives less
///         than sent). Used to verify the distributor credits the *received* balance
///         delta, not the requested amount. NOT for production.
contract MockFeeOnTransferERC20 is ERC20 {
    uint256 public immutable FEE_BPS; // e.g. 100 = 1%
    address constant SINK = address(0xdEaD);

    constructor(string memory name_, string memory symbol_, uint256 feeBps_) ERC20(name_, symbol_) {
        FEE_BPS = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        // No fee on mint/burn; fee only on holder-to-holder transfers.
        if (from != address(0) && to != address(0) && FEE_BPS > 0) {
            uint256 fee = (value * FEE_BPS) / 10_000;
            super._update(from, to, value - fee);
            if (fee > 0) super._update(from, SINK, fee);
        } else {
            super._update(from, to, value);
        }
    }
}
