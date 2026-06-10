// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CorporateActionRegistry } from "../src/CorporateActionRegistry.sol";
import { IActionSource } from "../src/interfaces/IActionSource.sol";
import { ActionType } from "../src/libraries/CorporateActionTypes.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { MockFunctionsRouter } from "../src/mocks/MockFunctionsRouter.sol";
import { FunctionsActionSource } from "../src/oracle/FunctionsActionSource.sol";
import { Test } from "forge-std/Test.sol";

/// @notice Verifies the production Chainlink-Functions-backed action source and its
///         integration with the registry's D3 seam.
contract FunctionsActionSourceTest is Test {
    address admin = address(this);
    address issuer = makeAddr("issuer");

    MockFunctionsRouter router;
    FunctionsActionSource source;
    CorporateActionRegistry registry;
    MockERC20 tsla;
    MockERC20 usdg;

    function setUp() public {
        router = new MockFunctionsRouter();
        source = new FunctionsActionSource(admin, address(router), 1, keccak256("don"), 300_000);
        source.setRequestData(hex"deadbeef"); // opaque CBOR request payload
        registry = new CorporateActionRegistry(admin, address(source));
        tsla = new MockERC20("Tesla", "TSLA", 18);
        usdg = new MockERC20("USDG", "USDG", 18);
        registry.setAssetIssuer(address(tsla), issuer);
    }

    function _dataHash() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(tsla),
                ActionType.CASH_DIVIDEND,
                uint256(1e18),
                uint64(block.number),
                uint64(block.timestamp),
                uint64(0),
                address(usdg),
                "ipfs://x"
            )
        );
    }

    /// @dev Request attestation for the canonical action (same fields as _dataHash/_announce).
    function _request() internal returns (bytes32 requestId) {
        return source.requestAttestation(
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
        assertEq(source.sourceType(), "chainlink-functions-v1");
    }

    function test_RequestThenFulfillAuthentic_AllowsAnnounce() public {
        bytes32 h = _dataHash();
        bytes32 reqId = _request();
        // Not attested yet.
        assertFalse(source.isAttested(address(tsla), h));

        // DON returns authentic = true.
        router.fulfill(address(source), reqId, abi.encode(true), "");
        assertTrue(source.isAttested(address(tsla), h));

        uint256 id = _announce();
        assertEq(id, 1);
    }

    function test_FulfillNotAuthentic_BlocksAnnounce() public {
        bytes32 h = _dataHash();
        bytes32 reqId = _request();
        router.fulfill(address(source), reqId, abi.encode(false), "");
        assertFalse(source.isAttested(address(tsla), h));

        vm.expectRevert(abi.encodeWithSelector(IActionSource.ActionNotAttested.selector, address(tsla), h));
        _announce();
    }

    function test_FulfillWithError_IsNotAuthentic() public {
        bytes32 h = _dataHash();
        bytes32 reqId = _request();
        router.fulfill(address(source), reqId, "", "vendor timeout");
        assertFalse(source.isAttested(address(tsla), h));
    }

    function test_OnlyRouterCanFulfill() public {
        bytes32 h = _dataHash();
        bytes32 reqId = _request();
        vm.expectRevert(abi.encodeWithSelector(FunctionsActionSource.OnlyRouter.selector, address(this)));
        source.handleOracleFulfillment(reqId, abi.encode(true), "");
    }

    function test_UnknownRequestReverts() public {
        vm.prank(address(router));
        vm.expectRevert(abi.encodeWithSelector(FunctionsActionSource.UnknownRequest.selector, bytes32(uint256(1))));
        source.handleOracleFulfillment(bytes32(uint256(1)), abi.encode(true), "");
    }

    function test_RequestWithoutPayloadReverts() public {
        FunctionsActionSource bare = new FunctionsActionSource(admin, address(router), 1, keccak256("don"), 300_000);
        vm.expectRevert(FunctionsActionSource.RequestNotConfigured.selector);
        bare.requestAttestation(
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

    function test_OnlyRequesterRoleCanRequest() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        _request();
    }
}
