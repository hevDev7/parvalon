// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DividendDistributor } from "../src/DividendDistributor.sol";
import { BaseTest } from "./Base.t.sol";
import { MerkleHelper } from "./utils/MerkleHelper.sol";

/// @notice Drives random valid claims against one fully-funded action.
contract ClaimHandler {
    DividendDistributor internal immutable distributor;
    uint256 internal immutable id;
    bytes32[] internal leaves;

    address[] internal accounts;
    uint256[] internal amounts;

    uint256 public claimsMade;

    constructor(
        DividendDistributor _distributor,
        uint256 _id,
        bytes32[] memory _leaves,
        address[] memory _accounts,
        uint256[] memory _amounts
    ) {
        distributor = _distributor;
        id = _id;
        leaves = _leaves;
        accounts = _accounts;
        amounts = _amounts;
    }

    /// @notice Claim a (possibly already-claimed) holder; no-ops if consumed.
    function claim(uint256 seed) external {
        uint256 pos = seed % accounts.length;
        if (distributor.isClaimed(id, pos)) return;
        bytes32[] memory proof = MerkleHelper.getProof(leaves, pos);
        distributor.claim(id, pos, accounts[pos], amounts[pos], proof);
        claimsMade++;
    }
}

/// @notice Protocol-level invariants for the distributor: it is always solvent and
///         never pays out more than was funded, no matter the claim ordering.
contract InvariantDistributorTest is BaseTest {
    ClaimHandler internal handler;
    uint256 internal actionId;
    uint256 internal fundedTotal;

    function setUp() public override {
        super.setUp();

        uint256 n = 8;
        Holder[] memory hs = new Holder[](n);
        address[] memory accounts = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            address acct = address(uint160(uint256(keccak256(abi.encode("inv-holder", i)))));
            uint256 amt = (i + 1) * 1e18;
            hs[i] = Holder({ account: acct, index: i, amount: amt });
            accounts[i] = acct;
            amounts[i] = amt;
            fundedTotal += amt;
        }

        actionId = _announceDividend(0.5e18, 0);
        _publish(actionId, hs);
        _fund(actionId, fundedTotal);

        bytes32[] memory leaves = _leaves(actionId, hs);
        handler = new ClaimHandler(distributor, actionId, leaves, accounts, amounts);

        targetContract(address(handler));
    }

    /// @notice The distributor's balance always equals funded minus claimed.
    function invariant_Solvency() public view {
        assertEq(
            usdg.balanceOf(address(distributor)), distributor.totalFunded(actionId) - distributor.totalClaimed(actionId)
        );
    }

    /// @notice Never pay out more than was funded.
    function invariant_ClaimedNeverExceedsFunded() public view {
        assertLe(distributor.totalClaimed(actionId), distributor.totalFunded(actionId));
    }

    /// @notice Funded total is fixed once CLAIMABLE (no overfunding sneaks in).
    function invariant_FundedCapped() public view {
        assertLe(distributor.totalFunded(actionId), fundedTotal);
    }
}
