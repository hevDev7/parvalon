// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CorporateActionRegistry } from "../src/CorporateActionRegistry.sol";
import { FunctionsActionSource } from "../src/oracle/FunctionsActionSource.sol";
import { Script, console2 } from "forge-std/Script.sol";

/// @title DeployFunctionsSource
/// @notice P0-4: deploys the production {FunctionsActionSource} (Chainlink Functions
///         DON attestations) and, when explicitly requested, atomically swaps it in
///         as the registry's {IActionSource}. This is the "promote off-chain
///         attestation" step that turns the open-testnet {AdminActionSource} into the
///         vendor-verified production source — with zero registry redeploys
///         (`registry.setActionSource(thisAddress)` is the only seam).
///
/// @dev Required env:
///        PRIVATE_KEY            broadcaster key (deployer; must be registry admin if SWAP=true)
///        FUNCTIONS_ROUTER       Chainlink Functions router address on the target chain
///        FUNCTIONS_SUBSCRIPTION subscription id that funds requests (uint64)
///        FUNCTIONS_DON_ID       target DON id (bytes32, e.g. fun-arbitrum-sepolia-1 encoded)
///      Optional env:
///        ADMIN_ADDRESS          governance owner of the new source (default: broadcaster)
///        FUNCTIONS_GAS_LIMIT    fulfillment callback gas limit (default: 300000)
///        SWAP                   "true" => call registry.setActionSource(it). Requires the
///                               broadcaster to hold DEFAULT_ADMIN_ROLE on the registry.
///                               Default "false": deploy only, leave the swap to governance.
///        REGISTRY_ADDRESS       registry to read/swap (else deployments/<chainId>.json `.registry`)
///
/// @dev Production note: when governance is a {TimelockController}/Safe (after
///      `DeployGovernance`), the broadcaster will NOT hold admin, so SWAP must stay
///      false here. Deploy the source with this script, then schedule
///      `setActionSource(<printed address>)` through the timelock — see
///      `docs/DEPLOY.md` ("Swap to FunctionsActionSource"). This script prints the
///      exact calldata for that path when SWAP is false.
contract DeployFunctionsSource is Script {
    function run() external {
        address broadcaster = vm.addr(vm.envUint("PRIVATE_KEY"));
        address admin = vm.envOr("ADMIN_ADDRESS", broadcaster);
        address router = vm.envAddress("FUNCTIONS_ROUTER");
        uint64 subId = uint64(vm.envUint("FUNCTIONS_SUBSCRIPTION"));
        bytes32 donId = vm.envBytes32("FUNCTIONS_DON_ID");
        uint32 gasLimit = uint32(vm.envOr("FUNCTIONS_GAS_LIMIT", uint256(300_000)));
        bool swap = vm.envOr("SWAP", false);

        address registryAddr = _resolveRegistry();
        CorporateActionRegistry registry = CorporateActionRegistry(registryAddr);

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        FunctionsActionSource source = new FunctionsActionSource(admin, router, subId, donId, gasLimit);

        // Optional atomic swap. Only valid while the broadcaster is still the
        // registry admin (i.e. before governance handover). Guarded so a wrong
        // SWAP=true on a governed deployment fails fast with a clear message
        // instead of a raw AccessControl revert.
        if (swap) {
            require(
                registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), broadcaster),
                "SWAP=true but broadcaster lacks DEFAULT_ADMIN_ROLE; route via timelock"
            );
            registry.setActionSource(address(source));
        }

        vm.stopBroadcast();

        _writeArtifact(registryAddr, address(source), router, subId, donId, gasLimit, admin, swap);

        console2.log("=== FunctionsActionSource deployed on chain", block.chainid, "===");
        console2.log("functionsActionSource", address(source));
        console2.log("registry             ", registryAddr);
        console2.log("router               ", router);
        console2.log("admin                ", admin);
        console2.log("subscriptionId       ", subId);
        console2.log("gasLimit             ", gasLimit);
        if (swap) {
            console2.log("registry.actionSource() swapped -> FunctionsActionSource");
        } else {
            console2.log("SWAP=false. Schedule this calldata through governance to promote it:");
            console2.log("  target  :", registryAddr);
            console2.logBytes(abi.encodeWithSelector(registry.setActionSource.selector, address(source)));
        }
    }

    /// @dev Registry address from env override, else the canonical deployments file.
    function _resolveRegistry() internal view returns (address registry) {
        registry = vm.envOr("REGISTRY_ADDRESS", address(0));
        if (registry == address(0)) {
            string memory path =
                string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
            string memory dep = vm.readFile(path);
            registry = vm.parseJsonAddress(dep, ".registry");
        }
    }

    /// @dev Persists the source address + config alongside the main deployment so
    ///      the indexer / ops tooling can discover it. Written to
    ///      `deployments/functions-source-<chainId>.json` rather than mutating the
    ///      frozen `<chainId>.json` (which `setActionSource` would make stale on its
    ///      `.actionSource` field; the indexer should always read `actionSource()`
    ///      on-chain — this artifact is provenance, not source of truth).
    function _writeArtifact(
        address registry,
        address source,
        address router,
        uint64 subId,
        bytes32 donId,
        uint32 gasLimit,
        address admin,
        bool swapped
    ) internal {
        string memory o = "functionsSource";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "registry", registry);
        vm.serializeAddress(o, "functionsActionSource", source);
        vm.serializeAddress(o, "router", router);
        vm.serializeAddress(o, "admin", admin);
        vm.serializeUint(o, "subscriptionId", subId);
        vm.serializeBytes32(o, "donId", donId);
        vm.serializeUint(o, "callbackGasLimit", gasLimit);
        string memory json = vm.serializeBool(o, "swappedIntoRegistry", swapped);

        string memory path =
            string.concat(vm.projectRoot(), "/../deployments/functions-source-", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
