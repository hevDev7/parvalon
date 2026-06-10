// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IFunctionsRouter
/// @notice Minimal subset of the Chainlink Functions router used by
///         {FunctionsActionSource}. Kept dependency-free so the contract compiles
///         and is fully testable without vendoring the entire Chainlink monorepo;
///         the signatures match `IFunctionsRouter.sendRequest` 1:1.
interface IFunctionsRouter {
    /// @notice Send a Functions request to the DON.
    /// @param subscriptionId Billing subscription that funds the request.
    /// @param data           CBOR-encoded request (source code, args, secrets ref).
    /// @param dataVersion    Request encoding version.
    /// @param callbackGasLimit Gas budget for the fulfillment callback.
    /// @param donId          Target DON id.
    /// @return requestId      The assigned request id.
    function sendRequest(
        uint64 subscriptionId,
        bytes calldata data,
        uint16 dataVersion,
        uint32 callbackGasLimit,
        bytes32 donId
    ) external returns (bytes32 requestId);
}
