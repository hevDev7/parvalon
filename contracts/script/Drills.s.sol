// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CorporateActionRegistry } from "../src/CorporateActionRegistry.sol";
import { DividendDistributor } from "../src/DividendDistributor.sol";
import { Script, console2 } from "forge-std/Script.sol";

/// @title Drills
/// @notice P0-7: on-chain emergency drills a runbook can invoke directly. Each
///         `external` function below is a self-contained, broadcastable action the
///         incident commander runs with `forge script script/Drills.s.sol:Drills
///         --sig "<fn>()" --rpc-url <chain> --broadcast` (the broadcaster key in
///         `PRIVATE_KEY` must hold the relevant role — PAUSER_ROLE for pause/unpause,
///         DEFAULT_ADMIN_ROLE for issuer rotation).
///
/// @dev These mirror `scripts/drills.sh` (cast) one-for-one; use whichever your
///      operator prefers. Both read the registry/distributor from
///      `deployments/<chainId>.json` (override with REGISTRY_ADDRESS /
///      DISTRIBUTOR_ADDRESS env). Every drill asserts post-state so a failed pause
///      reverts the script loudly instead of silently no-op'ing.
///
/// @dev Governance note: after `DeployGovernance`, PAUSER_ROLE lives on the Safe and
///      DEFAULT_ADMIN_ROLE on the timelock. In that world an EOA cannot run these;
///      `pauseDryRun()` / `unpauseDryRun()` print the exact target+calldata to submit
///      through the Safe / timelock instead. See `docs/RUNBOOK.md` and `docs/DR.md`.
contract Drills is Script {
    /*//////////////////////////////////////////////////////////////
                              PAUSE / UNPAUSE
    //////////////////////////////////////////////////////////////*/

    /// @notice DRILL: pause BOTH registry and distributor (full emergency stop).
    function pauseAll() external {
        (CorporateActionRegistry registry, DividendDistributor distributor) = _resolve();
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        registry.pause();
        distributor.pause();
        vm.stopBroadcast();
        require(registry.paused() && distributor.paused(), "drill: pause did not take effect");
        console2.log("DRILL pauseAll OK: registry.paused =", registry.paused());
        console2.log("DRILL pauseAll OK: distributor.paused =", distributor.paused());
    }

    /// @notice DRILL: unpause BOTH registry and distributor (resume after all-clear).
    function unpauseAll() external {
        (CorporateActionRegistry registry, DividendDistributor distributor) = _resolve();
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        registry.unpause();
        distributor.unpause();
        vm.stopBroadcast();
        require(!registry.paused() && !distributor.paused(), "drill: unpause did not take effect");
        console2.log("DRILL unpauseAll OK: registry.paused =", registry.paused());
        console2.log("DRILL unpauseAll OK: distributor.paused =", distributor.paused());
    }

    /// @notice DRILL: pause only the distributor (freeze claims, keep registry live).
    function pauseDistributor() external {
        (, DividendDistributor distributor) = _resolve();
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        distributor.pause();
        vm.stopBroadcast();
        require(distributor.paused(), "drill: distributor pause did not take effect");
        console2.log("DRILL pauseDistributor OK: paused =", distributor.paused());
    }

    /// @notice DRILL: unpause only the distributor.
    function unpauseDistributor() external {
        (, DividendDistributor distributor) = _resolve();
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        distributor.unpause();
        vm.stopBroadcast();
        require(!distributor.paused(), "drill: distributor unpause did not take effect");
        console2.log("DRILL unpauseDistributor OK: paused =", distributor.paused());
    }

    /*//////////////////////////////////////////////////////////////
                              ISSUER ROTATION
    //////////////////////////////////////////////////////////////*/

    /// @notice DRILL: rotate the issuer for an asset (e.g. compromised issuer key).
    /// @dev Env: ROTATE_ASSET (address), ROTATE_NEW_ISSUER (address). Broadcaster
    ///      must hold DEFAULT_ADMIN_ROLE on the registry.
    function rotateIssuer() external {
        (CorporateActionRegistry registry,) = _resolve();
        address asset = vm.envAddress("ROTATE_ASSET");
        address newIssuer = vm.envAddress("ROTATE_NEW_ISSUER");
        address prev = registry.assetIssuer(asset);

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        registry.setAssetIssuer(asset, newIssuer);
        vm.stopBroadcast();

        require(registry.assetIssuer(asset) == newIssuer, "drill: issuer rotation did not take effect");
        console2.log("DRILL rotateIssuer OK for asset", asset);
        console2.log("  previous issuer", prev);
        console2.log("  new issuer     ", newIssuer);
    }

    /*//////////////////////////////////////////////////////////////
                          READ-ONLY / GOVERNANCE
    //////////////////////////////////////////////////////////////*/

    /// @notice Print current pause + role-holder state without broadcasting.
    /// @dev Run with `--sig "status()"` (no key needed). Useful pre/post drill.
    function status() external view {
        (CorporateActionRegistry registry, DividendDistributor distributor) = _resolve();
        console2.log("registry           ", address(registry));
        console2.log("  paused           ", registry.paused());
        console2.log("  actionSource     ", registry.actionSource());
        console2.log("distributor        ", address(distributor));
        console2.log("  paused           ", distributor.paused());
        console2.log("  registry()       ", distributor.registry());
    }

    /// @notice GOVERNED PATH: print the (target, calldata) pairs to submit through a
    ///         Safe/timelock when an EOA no longer holds PAUSER_ROLE. Does not broadcast.
    function pauseDryRun() external view {
        (CorporateActionRegistry registry, DividendDistributor distributor) = _resolve();
        console2.log("Submit these two calls (PAUSER_ROLE, via Safe) to pause everything:");
        console2.log("  target", address(registry));
        console2.logBytes(abi.encodeWithSelector(registry.pause.selector));
        console2.log("  target", address(distributor));
        console2.logBytes(abi.encodeWithSelector(distributor.pause.selector));
    }

    /// @notice GOVERNED PATH: calldata to unpause both via Safe. Does not broadcast.
    function unpauseDryRun() external view {
        (CorporateActionRegistry registry, DividendDistributor distributor) = _resolve();
        console2.log("Submit these two calls (PAUSER_ROLE, via Safe) to resume:");
        console2.log("  target", address(registry));
        console2.logBytes(abi.encodeWithSelector(registry.unpause.selector));
        console2.log("  target", address(distributor));
        console2.logBytes(abi.encodeWithSelector(distributor.unpause.selector));
    }

    /// @notice GOVERNED PATH: calldata for issuer rotation via the timelock
    ///         (DEFAULT_ADMIN_ROLE). Env: ROTATE_ASSET, ROTATE_NEW_ISSUER. No broadcast.
    function rotateIssuerDryRun() external view {
        (CorporateActionRegistry registry,) = _resolve();
        address asset = vm.envAddress("ROTATE_ASSET");
        address newIssuer = vm.envAddress("ROTATE_NEW_ISSUER");
        console2.log("Schedule via timelock (DEFAULT_ADMIN_ROLE):");
        console2.log("  target", address(registry));
        console2.logBytes(abi.encodeWithSelector(registry.setAssetIssuer.selector, asset, newIssuer));
    }

    /*//////////////////////////////////////////////////////////////
                                 INTERNAL
    //////////////////////////////////////////////////////////////*/

    function _resolve() internal view returns (CorporateActionRegistry registry, DividendDistributor distributor) {
        address registryAddr = vm.envOr("REGISTRY_ADDRESS", address(0));
        address distributorAddr = vm.envOr("DISTRIBUTOR_ADDRESS", address(0));
        if (registryAddr == address(0) || distributorAddr == address(0)) {
            string memory path =
                string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
            string memory dep = vm.readFile(path);
            if (registryAddr == address(0)) registryAddr = vm.parseJsonAddress(dep, ".registry");
            if (distributorAddr == address(0)) distributorAddr = vm.parseJsonAddress(dep, ".distributor");
        }
        registry = CorporateActionRegistry(registryAddr);
        distributor = DividendDistributor(distributorAddr);
    }
}
