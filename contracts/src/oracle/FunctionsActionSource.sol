// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IActionSource } from "../interfaces/IActionSource.sol";
import { IFunctionsRouter } from "../interfaces/IFunctionsRouter.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title FunctionsActionSource
/// @author CorporaX
/// @notice Production implementation of the {IActionSource} seam (PRD D3, P0-4):
///         corporate-action authenticity is verified off-chain by a **Chainlink
///         Functions** DON against a licensed data vendor, and the verdict is
///         written back on-chain before an announcement is allowed.
///
/// @dev Flow:
///  1. An operator (or the registry's issuer tooling) calls {requestAttestation}
///     with the action `dataHash`. This emits a Functions request via the router.
///  2. The DON runs the off-chain source (see `docs/RUNBOOK.md` "Functions source"),
///     which fetches the issuer filing / vendor feed and checks that the action
///     matches `dataHash`, returning `abi.encode(bool authentic)`.
///  3. The router calls {handleOracleFulfillment}; we record the attestation.
///  4. {CorporateActionRegistry.announceAction} calls {validateAnnouncement},
///     which reverts unless the DON attested the exact `dataHash` as authentic.
///
/// Swapping {AdminActionSource} → this contract requires only
/// `registry.setActionSource(thisAddress)` — zero registry changes. The router is
/// abstracted behind {IFunctionsRouter} so the contract is testable with a mock.
contract FunctionsActionSource is IActionSource, AccessControl {
    /// @notice May trigger Functions requests (issuer ops / keeper).
    bytes32 public constant REQUESTER_ROLE = keccak256("REQUESTER_ROLE");

    /// @notice The Chainlink Functions router.
    IFunctionsRouter public immutable ROUTER;

    /// @notice Functions billing subscription id.
    uint64 public subscriptionId;
    /// @notice Target DON id.
    bytes32 public donId;
    /// @notice Fulfillment callback gas limit.
    uint32 public callbackGasLimit;
    /// @notice CBOR-encoded Functions request (source + config), set by admin.
    bytes public requestData;

    struct PendingRequest {
        address asset;
        bytes32 dataHash;
        bool exists;
    }

    /// @dev key(asset, dataHash) => authentic.
    mapping(bytes32 key => bool authentic) private _attested;
    /// @dev requestId => the (asset, dataHash) it attests, for the fulfillment callback.
    mapping(bytes32 requestId => PendingRequest meta) private _pending;

    event AttestationRequested(address indexed asset, bytes32 indexed dataHash, bytes32 requestId);
    event AttestationFulfilled(address indexed asset, bytes32 indexed dataHash, bool authentic);
    event ConfigUpdated(uint64 subscriptionId, bytes32 donId, uint32 callbackGasLimit);

    error OnlyRouter(address caller);
    error UnknownRequest(bytes32 requestId);
    error RequestNotConfigured();

    /// @param admin   Governance (multisig/timelock); gets admin + requester roles.
    /// @param router  The Chainlink Functions router.
    /// @param subId   Functions subscription id.
    /// @param don     DON id.
    /// @param gasLimit Fulfillment callback gas limit.
    constructor(address admin, address router, uint64 subId, bytes32 don, uint32 gasLimit) {
        require(admin != address(0) && router != address(0), "zero addr");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REQUESTER_ROLE, admin);
        ROUTER = IFunctionsRouter(router);
        subscriptionId = subId;
        donId = don;
        callbackGasLimit = gasLimit;
    }

    /*//////////////////////////////////////////////////////////////
                                  ADMIN
    //////////////////////////////////////////////////////////////*/

    /// @notice Set the CBOR-encoded Functions request payload (source code + args).
    /// @dev Built off-chain with the Functions toolkit; opaque to this contract.
    function setRequestData(bytes calldata data) external onlyRole(DEFAULT_ADMIN_ROLE) {
        requestData = data;
    }

    /// @notice Update billing / DON / gas configuration.
    function setConfig(uint64 subId, bytes32 don, uint32 gasLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        subscriptionId = subId;
        donId = don;
        callbackGasLimit = gasLimit;
        emit ConfigUpdated(subId, don, gasLimit);
    }

    /*//////////////////////////////////////////////////////////////
                            REQUEST / FULFILL
    //////////////////////////////////////////////////////////////*/

    /// @notice Ask the DON to verify `(asset, dataHash)` against the data vendor.
    /// @return requestId The Functions request id.
    function requestAttestation(address asset, bytes32 dataHash)
        external
        onlyRole(REQUESTER_ROLE)
        returns (bytes32 requestId)
    {
        if (requestData.length == 0) revert RequestNotConfigured();
        requestId = ROUTER.sendRequest(subscriptionId, requestData, 1, callbackGasLimit, donId);
        _pending[requestId] = PendingRequest({ asset: asset, dataHash: dataHash, exists: true });
        emit AttestationRequested(asset, dataHash, requestId);
    }

    /// @notice Chainlink Functions fulfillment entrypoint. Only the router may call.
    /// @param requestId The request being fulfilled.
    /// @param response  `abi.encode(bool authentic)` from the DON (empty if errored).
    /// @param err       DON error bytes (non-empty => treat as not authentic).
    function handleOracleFulfillment(bytes32 requestId, bytes memory response, bytes memory err) external {
        if (msg.sender != address(ROUTER)) revert OnlyRouter(msg.sender);
        PendingRequest memory p = _pending[requestId];
        if (!p.exists) revert UnknownRequest(requestId);
        delete _pending[requestId];

        bool authentic = err.length == 0 && response.length == 32 && abi.decode(response, (bool));
        _attested[_key(p.asset, p.dataHash)] = authentic;
        emit AttestationFulfilled(p.asset, p.dataHash, authentic);
    }

    /*//////////////////////////////////////////////////////////////
                               IActionSource
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IActionSource
    function validateAnnouncement(
        address asset,
        address,
        /*announcer*/
        bytes32 dataHash
    )
        external
        view
    {
        if (!_attested[_key(asset, dataHash)]) revert ActionNotAttested(asset, dataHash);
    }

    /// @inheritdoc IActionSource
    function sourceType() external pure returns (string memory) {
        return "chainlink-functions-v1";
    }

    /// @notice Whether the DON attested `(asset, dataHash)` as authentic.
    function isAttested(address asset, bytes32 dataHash) external view returns (bool) {
        return _attested[_key(asset, dataHash)];
    }

    function _key(address asset, bytes32 dataHash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(asset, dataHash));
    }
}
