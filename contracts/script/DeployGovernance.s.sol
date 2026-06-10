// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CorporateActionRegistry } from "../src/CorporateActionRegistry.sol";
import { DividendDistributor } from "../src/DividendDistributor.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { Script, console2 } from "forge-std/Script.sol";

/// @title DeployGovernance
/// @notice P0-1 + P0-2: hands the protocol over to production governance.
///         Deploys a {TimelockController} that holds `DEFAULT_ADMIN_ROLE` on both
///         contracts (slow, observable privilege changes, proposed by the Safe),
///         and grants `PAUSER_ROLE` to the Safe directly (fast emergency stop).
///         Finally the deployer renounces both roles, so no single EOA retains power.
///
/// @dev Run by the current admin (the original deployer). Required env:
///        PRIVATE_KEY        current admin/deployer key
///        SAFE_ADDRESS       the Gnosis Safe multisig (proposer/executor + pauser)
///      Optional env:
///        TIMELOCK_MIN_DELAY seconds (default 172800 = 2 days)
///        REGISTRY_ADDRESS / DISTRIBUTOR_ADDRESS (else read from deployments/<chainId>.json)
contract DeployGovernance is Script {
    function run() external {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        address safe = vm.envAddress("SAFE_ADDRESS");
        uint256 minDelay = vm.envOr("TIMELOCK_MIN_DELAY", uint256(2 days));

        (address registryAddr, address distributorAddr) = _resolveAddrs();
        CorporateActionRegistry registry = CorporateActionRegistry(registryAddr);
        DividendDistributor distributor = DividendDistributor(distributorAddr);

        bytes32 ADMIN = registry.DEFAULT_ADMIN_ROLE();

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        // Safe is the sole proposer & executor; the timelock self-administers.
        address[] memory proposers = new address[](1);
        proposers[0] = safe;
        address[] memory executors = new address[](1);
        executors[0] = safe;
        TimelockController timelock = new TimelockController(minDelay, proposers, executors, address(0));

        // Registry: admin -> timelock, pauser -> Safe, then deployer steps down.
        registry.grantRole(ADMIN, address(timelock));
        registry.grantRole(registry.PAUSER_ROLE(), safe);
        registry.renounceRole(registry.PAUSER_ROLE(), deployer);
        registry.renounceRole(ADMIN, deployer);

        // Distributor: same handover.
        distributor.grantRole(ADMIN, address(timelock));
        distributor.grantRole(distributor.PAUSER_ROLE(), safe);
        distributor.renounceRole(distributor.PAUSER_ROLE(), deployer);
        distributor.renounceRole(ADMIN, deployer);

        vm.stopBroadcast();

        _writeGovernance(address(timelock), safe, minDelay);

        console2.log("=== Governance handover complete ===");
        console2.log("timelock     ", address(timelock));
        console2.log("safe (pauser)", safe);
        console2.log("minDelay (s) ", minDelay);
        console2.log("deployer renounced admin + pauser on registry and distributor.");
    }

    function _resolveAddrs() internal view returns (address registry, address distributor) {
        registry = vm.envOr("REGISTRY_ADDRESS", address(0));
        distributor = vm.envOr("DISTRIBUTOR_ADDRESS", address(0));
        if (registry == address(0) || distributor == address(0)) {
            string memory path =
                string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
            string memory dep = vm.readFile(path);
            registry = vm.parseJsonAddress(dep, ".registry");
            distributor = vm.parseJsonAddress(dep, ".distributor");
        }
    }

    function _writeGovernance(address timelock, address safe, uint256 minDelay) internal {
        string memory o = "gov";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "timelock", timelock);
        vm.serializeAddress(o, "safe", safe);
        string memory json = vm.serializeUint(o, "minDelaySeconds", minDelay);
        string memory path =
            string.concat(vm.projectRoot(), "/../deployments/governance-", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
