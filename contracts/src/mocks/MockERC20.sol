// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @author CorporaX
/// @notice Minimal mintable ERC20 with configurable decimals. Stands in for both
///         the payout token (USDG) and the tokenized stocks (TSLA/AMZN) on local
///         and fallback (Arbitrum Sepolia) networks where the real assets do not
///         exist. NOT for production use.
/// @dev Open `mint` is intentional — these are faucet-style test tokens. The
///      snapshot CLI reconstructs balances from the Transfer events these emit,
///      exactly as it would against the real on-chain stock tokens.
contract MockERC20 is ERC20 {
    uint8 private immutable _DECIMALS;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _DECIMALS = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice Mint `amount` to `to`. Open by design (test faucet).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Burn `amount` from caller.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
