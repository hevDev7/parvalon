// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IActionSource
/// @author Parvalon
/// @notice The pluggable "source of truth" seam for corporate-action data.
/// @dev This is design decision D3 from the PRD made concrete. In a real
///      transfer-agent stack the *authenticity* of a corporate action originates
///      off-chain (issuer filing, DTCC ISO-20022 message, data vendor feed). The
///      registry never hard-codes where that truth comes from — it calls
///      {validateAnnouncement} on whatever IActionSource is currently configured.
///
///      - v1 (testnet/hackathon): {AdminActionSource} — issuer-fed attestations.
///      - production: a `ChainlinkFunctionsActionSource` that pulls the action
///        from a licensed data vendor and verifies `dataHash` before allowing it
///        on-chain. Swapping the source requires ZERO changes to the registry.
///
///      Implementations MUST revert (not return false) when an announcement is
///      not vouched for, so the registry can rely on a clean call.
interface IActionSource {
    /// @notice Reverts when the source cannot vouch for the supplied announcement.
    error ActionNotAttested(address asset, bytes32 dataHash);

    /// @notice Validate that `announcer` may record this action for `asset`.
    /// @dev Called by the registry inside `announceAction`, before any state is
    ///      written. `view` by design: any attestation a source needs must be
    ///      established in a prior, explicit transaction (see
    ///      {AdminActionSource.attest}). MUST revert on failure.
    /// @param asset      The tokenized stock the action targets.
    /// @param announcer  The caller of `announceAction` on the registry.
    /// @param dataHash   keccak256 of the canonical action payload (see registry).
    function validateAnnouncement(address asset, address announcer, bytes32 dataHash) external view;

    /// @notice Stable identifier of the concrete source implementation.
    /// @return A short machine-readable tag, e.g. "admin-attested-v1" or
    ///         "chainlink-functions-v1". Surfaced in docs and the action feed so
    ///         integrators know how much to trust an action's provenance.
    function sourceType() external view returns (string memory);
}
