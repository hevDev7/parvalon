// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CorporateActionRegistry } from "../src/CorporateActionRegistry.sol";
import { IActionSource } from "../src/interfaces/IActionSource.sol";
import { ActionType } from "../src/libraries/CorporateActionTypes.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { AdminActionSource } from "../src/oracle/AdminActionSource.sol";
import { Test } from "forge-std/Test.sol";

/// @notice Exercises the D3 provenance seam, including the production-mode path
///         where auto-attest is OFF and every announcement requires an attestation.
contract AdminActionSourceTest is Test {
    address admin = address(this);
    address issuer = makeAddr("issuer");

    AdminActionSource source;
    CorporateActionRegistry registry;
    MockERC20 tsla;
    MockERC20 usdg;

    function setUp() public {
        source = new AdminActionSource(admin, false); // production mode: no auto-attest
        registry = new CorporateActionRegistry(admin, address(source));
        tsla = new MockERC20("Tesla", "TSLA", 18);
        usdg = new MockERC20("USDG", "USDG", 18);
        registry.setAssetIssuer(address(tsla), issuer);
    }

    function _dataHash(uint64 recordBlock) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(tsla),
                ActionType.CASH_DIVIDEND,
                uint256(1e18),
                recordBlock,
                uint64(block.timestamp),
                uint64(0),
                address(usdg),
                "ipfs://x"
            )
        );
    }

    function _announce() internal returns (uint256) {
        vm.prank(issuer);
        return registry.announceAction(
            address(tsla),
            ActionType.CASH_DIVIDEND,
            1e18,
            uint64(block.number),
            uint64(block.timestamp),
            0,
            address(usdg),
            "ipfs://x"
        );
    }

    function test_SourceType() public view {
        assertEq(source.sourceType(), "admin-attested-v1");
    }

    function test_NoAutoAttest_RevertsUnattested() public {
        bytes32 h = _dataHash(uint64(block.number));
        vm.expectRevert(abi.encodeWithSelector(IActionSource.ActionNotAttested.selector, address(tsla), h));
        _announce();
    }

    function test_Attest_ThenAnnounceSucceeds() public {
        bytes32 h = _dataHash(uint64(block.number));
        source.attest(address(tsla), h);
        assertTrue(source.isAttested(address(tsla), h));
        uint256 id = _announce();
        assertEq(id, 1);
    }

    function test_Revoke_BlocksAnnounce() public {
        bytes32 h = _dataHash(uint64(block.number));
        source.attest(address(tsla), h);
        source.revokeAttestation(address(tsla), h);
        vm.expectRevert(abi.encodeWithSelector(IActionSource.ActionNotAttested.selector, address(tsla), h));
        _announce();
    }

    function test_AutoAttestToggle_OpensGate() public {
        source.setAutoAttest(true);
        uint256 id = _announce();
        assertEq(id, 1);
    }
}
