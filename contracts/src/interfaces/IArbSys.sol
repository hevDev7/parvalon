// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IArbSys
/// @notice Minimal interface to the Arbitrum ArbSys precompile at 0x64. On
///         Arbitrum/Orbit chains the EVM `block.number` is the L1 block number,
///         whereas `arbBlockNumber()` returns the L2 block number — the value that
///         `eth_blockNumber` / `eth_getLogs` and the off-chain snapshot tooling use.
interface IArbSys {
    function arbBlockNumber() external view returns (uint256);
}
