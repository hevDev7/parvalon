// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IFunctionsRouter } from "../interfaces/IFunctionsRouter.sol";

interface IFunctionsConsumer {
    function handleOracleFulfillment(bytes32 requestId, bytes memory response, bytes memory err) external;
}

/// @title MockFunctionsRouter
/// @notice Test double for the Chainlink Functions router. Captures requests and
///         lets a test simulate the DON fulfilling them. NOT for production.
contract MockFunctionsRouter is IFunctionsRouter {
    uint256 public nonce;
    bytes32 public lastRequestId;
    address public lastConsumer;

    function sendRequest(uint64, bytes calldata, uint16, uint32, bytes32) external returns (bytes32 requestId) {
        requestId = keccak256(abi.encodePacked(msg.sender, block.number, ++nonce));
        lastRequestId = requestId;
        lastConsumer = msg.sender;
    }

    /// @notice Simulate the DON returning a verdict to the consumer.
    function fulfill(address consumer, bytes32 requestId, bytes memory response, bytes memory err) external {
        IFunctionsConsumer(consumer).handleOracleFulfillment(requestId, response, err);
    }
}
