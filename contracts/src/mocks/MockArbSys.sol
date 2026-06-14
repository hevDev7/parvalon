// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal stand-in for the Arbitrum ArbSys precompile (0x64) used in
///         tests via `vm.etch`. `arbBlockNumber()` returns a value set through
///         storage slot 0 so it can be controlled independently of `block.number`.
contract MockArbSys {
    uint256 public fakeBlockNumber;

    function setBlock(uint256 b) external {
        fakeBlockNumber = b;
    }

    function arbBlockNumber() external view returns (uint256) {
        return fakeBlockNumber;
    }
}
