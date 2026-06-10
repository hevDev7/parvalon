// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CorporateActionRegistry } from "../src/CorporateActionRegistry.sol";
import { DividendDistributor } from "../src/DividendDistributor.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { AdminActionSource } from "../src/oracle/AdminActionSource.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { Test } from "forge-std/Test.sol";

/// @notice Proves the production governance model (P0-1/P0-2):
///   - `DEFAULT_ADMIN_ROLE` on both contracts sits behind a `TimelockController`
///     (slow, observable privilege changes; the Safe multisig is the proposer).
///   - `PAUSER_ROLE` is held by the Safe directly (fast emergency stop — safe to
///     be immediate because pausing only halts, it never moves funds).
contract GovernanceTest is Test {
    uint256 constant MIN_DELAY = 2 days;

    address deployer = address(this);
    address safe = makeAddr("safe-multisig"); // stands in for a Gnosis Safe
    address issuer = makeAddr("issuer");

    TimelockController timelock;
    CorporateActionRegistry registry;
    DividendDistributor distributor;
    AdminActionSource source;
    MockERC20 tsla;

    function setUp() public {
        // Deploy protocol with the deployer as initial admin.
        source = new AdminActionSource(deployer, true);
        registry = new CorporateActionRegistry(deployer, address(source));
        distributor = new DividendDistributor(address(registry), deployer);
        registry.grantRole(registry.DISTRIBUTOR_ROLE(), address(distributor));
        tsla = new MockERC20("Tesla", "TSLA", 18);

        // Timelock: the Safe proposes & executes; the timelock self-administers.
        address[] memory proposers = new address[](1);
        proposers[0] = safe;
        address[] memory executors = new address[](1);
        executors[0] = safe;
        timelock = new TimelockController(MIN_DELAY, proposers, executors, address(0));

        // --- Hand over governance (mirrors DeployGovernance.s.sol) ---
        // Admin -> timelock; Pauser -> Safe (fast path). Then deployer renounces.
        bytes32 ADMIN = registry.DEFAULT_ADMIN_ROLE();
        registry.grantRole(ADMIN, address(timelock));
        registry.grantRole(registry.PAUSER_ROLE(), safe);
        registry.renounceRole(registry.PAUSER_ROLE(), deployer);
        registry.renounceRole(ADMIN, deployer);

        distributor.grantRole(ADMIN, address(timelock));
        distributor.grantRole(distributor.PAUSER_ROLE(), safe);
        distributor.renounceRole(distributor.PAUSER_ROLE(), deployer);
        distributor.renounceRole(ADMIN, deployer);
    }

    function test_DeployerNoLongerAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, deployer, registry.DEFAULT_ADMIN_ROLE()
            )
        );
        registry.setAssetIssuer(address(tsla), issuer);
    }

    function test_AdminOp_RequiresTimelock() public {
        bytes memory data = abi.encodeCall(registry.setAssetIssuer, (address(tsla), issuer));

        // Safe schedules the op.
        vm.prank(safe);
        timelock.schedule(address(registry), 0, data, bytes32(0), bytes32(0), MIN_DELAY);

        // Executing before the delay reverts.
        vm.prank(safe);
        vm.expectRevert();
        timelock.execute(address(registry), 0, data, bytes32(0), bytes32(0));

        // After the delay it executes; the registry now reflects the change.
        vm.warp(block.timestamp + MIN_DELAY + 1);
        vm.prank(safe);
        timelock.execute(address(registry), 0, data, bytes32(0), bytes32(0));
        assertEq(registry.assetIssuer(address(tsla)), issuer);
    }

    function test_FastPause_BySafe_NoDelay() public {
        // Emergency pause is immediate — no timelock in the critical path.
        vm.prank(safe);
        distributor.pause();
        assertTrue(distributor.paused());

        // And only the Safe (pauser) can do it.
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, deployer, distributor.PAUSER_ROLE()
            )
        );
        distributor.unpause();

        vm.prank(safe);
        distributor.unpause();
        assertFalse(distributor.paused());
    }

    function test_TimelockCanSwapOracleSource() public {
        AdminActionSource newSource = new AdminActionSource(address(timelock), false);
        bytes memory data = abi.encodeCall(registry.setActionSource, (address(newSource)));
        vm.prank(safe);
        timelock.schedule(address(registry), 0, data, bytes32(0), bytes32(0), MIN_DELAY);
        vm.warp(block.timestamp + MIN_DELAY + 1);
        vm.prank(safe);
        timelock.execute(address(registry), 0, data, bytes32(0), bytes32(0));
        assertEq(registry.actionSource(), address(newSource));
    }
}
