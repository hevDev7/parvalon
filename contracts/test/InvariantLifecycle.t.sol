// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CorporateActionRegistry } from "../src/CorporateActionRegistry.sol";
import { DividendDistributor } from "../src/DividendDistributor.sol";
import { ActionStatus } from "../src/libraries/CorporateActionTypes.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { BaseTest } from "./Base.t.sol";
import { MerkleHelper } from "./utils/MerkleHelper.sol";

/// @notice Fuzzes funding AND claiming across the full lifecycle of one action.
contract LifecycleHandler {
    DividendDistributor internal immutable distributor;
    CorporateActionRegistry internal immutable registry;
    MockERC20 internal immutable usdg;
    uint256 internal immutable id;
    uint256 internal immutable totalPayout;
    bytes32[] internal leaves;
    address[] internal accounts;
    uint256[] internal amounts;

    constructor(
        DividendDistributor _distributor,
        CorporateActionRegistry _registry,
        MockERC20 _usdg,
        uint256 _id,
        uint256 _totalPayout,
        bytes32[] memory _leaves,
        address[] memory _accounts,
        uint256[] memory _amounts
    ) {
        distributor = _distributor;
        registry = _registry;
        usdg = _usdg;
        id = _id;
        totalPayout = _totalPayout;
        leaves = _leaves;
        accounts = _accounts;
        amounts = _amounts;
    }

    /// @notice Fund a random partial amount toward the cap (anyone may fund).
    function fund(uint256 amount) external {
        if (registry.getAction(id).status != ActionStatus.ROOT_PUBLISHED) return;
        uint256 remaining = totalPayout - distributor.totalFunded(id);
        if (remaining == 0) return;
        amount = (amount % remaining) + 1; // 1..remaining
        usdg.mint(address(this), amount);
        usdg.approve(address(distributor), amount);
        distributor.fund(id, amount);
    }

    /// @notice Claim a random holder if the action is claimable.
    function claim(uint256 seed) external {
        if (registry.getAction(id).status != ActionStatus.CLAIMABLE) return;
        uint256 pos = seed % accounts.length;
        if (distributor.isClaimed(id, pos)) return;
        distributor.claim(id, pos, accounts[pos], amounts[pos], MerkleHelper.getProof(leaves, pos));
    }
}

/// @notice Lifecycle + accounting invariants (P0-3 / formal-verification candidates).
contract InvariantLifecycleTest is BaseTest {
    LifecycleHandler internal handler;
    uint256 internal actionId;
    uint256 internal totalPayout;
    bytes32 internal originalRoot;

    function setUp() public override {
        super.setUp();

        uint256 n = 6;
        Holder[] memory hs = new Holder[](n);
        address[] memory accounts = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            address acct = address(uint160(uint256(keccak256(abi.encode("lc-holder", i)))));
            uint256 amt = (i + 1) * 3e18;
            hs[i] = Holder({ account: acct, index: i, amount: amt });
            accounts[i] = acct;
            amounts[i] = amt;
            totalPayout += amt;
        }

        actionId = _announceDividend(0.5e18, 0);
        (originalRoot,) = _publish(actionId, hs); // published, NOT funded — handler funds

        bytes32[] memory leaves = _leaves(actionId, hs);
        handler = new LifecycleHandler(distributor, registry, usdg, actionId, totalPayout, leaves, accounts, amounts);
        targetContract(address(handler));
    }

    /// @notice The Merkle root is immutable once published.
    function invariant_RootImmutable() public view {
        assertEq(registry.getAction(actionId).merkleRoot, originalRoot);
    }

    /// @notice The distributor holds exactly funded − claimed for this action.
    function invariant_Conservation() public view {
        assertEq(
            usdg.balanceOf(address(distributor)), distributor.totalFunded(actionId) - distributor.totalClaimed(actionId)
        );
    }

    /// @notice CLAIMABLE implies the action is fully funded to its target.
    function invariant_ClaimableImpliesFullyFunded() public view {
        if (registry.getAction(actionId).status == ActionStatus.CLAIMABLE) {
            assertEq(distributor.totalFunded(actionId), totalPayout);
        }
    }

    /// @notice Funded is capped at the published total; claimed never exceeds funded.
    function invariant_Bounds() public view {
        assertLe(distributor.totalFunded(actionId), totalPayout);
        assertLe(distributor.totalClaimed(actionId), distributor.totalFunded(actionId));
    }

    /// @notice Status only ever advances ANNOUNCED→ROOT_PUBLISHED→CLAIMABLE here
    ///         (never regresses, never CANCELLED/FINALIZED in this scenario).
    function invariant_StatusForwardOnly() public view {
        uint8 s = uint8(registry.getAction(actionId).status);
        assertTrue(s == uint8(ActionStatus.ROOT_PUBLISHED) || s == uint8(ActionStatus.CLAIMABLE));
    }
}
