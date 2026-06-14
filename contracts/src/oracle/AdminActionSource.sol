// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IActionSource } from "../interfaces/IActionSource.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AdminActionSource
/// @author Parvalon
/// @notice The v1 (testnet/hackathon) implementation of the {IActionSource} seam.
///         It models the real-world fact that a corporate action's authenticity
///         originates with the issuer / registrar. Authorized attesters vouch for
///         an action's `dataHash`; the registry then records it.
/// @dev This contract is deliberately thin. The same {IActionSource} interface is
///      what a production `ChainlinkFunctionsActionSource` would implement —
///      pulling the action from a licensed data vendor and verifying the hash —
///      so the registry never changes when provenance is upgraded (PRD D3).
///
///      `autoAttest` exists so a clean testnet demo is a single transaction. In
///      production it is set to `false` and every announcement must be explicitly
///      attested, giving a real off-chain → on-chain provenance gate.
contract AdminActionSource is IActionSource, AccessControl {
    /// @notice May attest / revoke action data hashes.
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");

    /// @notice When true, any announcement validates without explicit attestation.
    ///         Intended for testnet only. Production: false.
    bool public autoAttest;

    /// @dev keccak256(asset, dataHash) => attested.
    mapping(bytes32 key => bool ok) private _attested;

    /// @notice Emitted when an action data hash is attested.
    event Attested(address indexed asset, bytes32 indexed dataHash, address indexed attester);
    /// @notice Emitted when an attestation is revoked.
    event AttestationRevoked(address indexed asset, bytes32 indexed dataHash);
    /// @notice Emitted when the auto-attest flag changes.
    event AutoAttestSet(bool enabled);

    /// @param admin       Governance address; receives admin + attester roles.
    /// @param autoAttest_ Initial auto-attest setting (true for testnet demos).
    constructor(address admin, bool autoAttest_) {
        require(admin != address(0), "admin=0");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTER_ROLE, admin);
        autoAttest = autoAttest_;
        emit AutoAttestSet(autoAttest_);
    }

    /// @notice Attest that an action `dataHash` for `asset` is authentic.
    function attest(address asset, bytes32 dataHash) external onlyRole(ATTESTER_ROLE) {
        _attested[_key(asset, dataHash)] = true;
        emit Attested(asset, dataHash, msg.sender);
    }

    /// @notice Revoke a previously made attestation.
    function revokeAttestation(address asset, bytes32 dataHash) external onlyRole(ATTESTER_ROLE) {
        _attested[_key(asset, dataHash)] = false;
        emit AttestationRevoked(asset, dataHash);
    }

    /// @notice Toggle auto-attest. Production deployments set this to false.
    function setAutoAttest(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        autoAttest = enabled;
        emit AutoAttestSet(enabled);
    }

    /// @notice Whether an action `dataHash` for `asset` is currently attested.
    function isAttested(address asset, bytes32 dataHash) external view returns (bool) {
        return _attested[_key(asset, dataHash)];
    }

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
        if (autoAttest) return;
        if (!_attested[_key(asset, dataHash)]) revert ActionNotAttested(asset, dataHash);
    }

    /// @inheritdoc IActionSource
    function sourceType() external pure returns (string memory) {
        return "admin-attested-v1";
    }

    function _key(address asset, bytes32 dataHash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(asset, dataHash));
    }
}
