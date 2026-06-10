// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CorporateActionRegistry } from "../src/CorporateActionRegistry.sol";
import { DividendDistributor } from "../src/DividendDistributor.sol";
import { ActionType } from "../src/libraries/CorporateActionTypes.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { MerkleHelper } from "../test/utils/MerkleHelper.sol";
import { Script, console2 } from "forge-std/Script.sol";

/// @title Seed
/// @notice One-command demo state for local/Sepolia (MOCK tokens only): mints
///         stock to two demo holders, announces a TSLA cash dividend, publishes
///         the snapshot root, funds it to CLAIMABLE, and writes a canonical
///         `proofs.json` the frontend serves directly.
/// @dev This is the *convenience* path that bypasses the off-chain snapshot CLI by
///      computing the root in Solidity over a known holder set. The production
///      path is `pnpm snapshot` over real `recordBlock` logs. Requires the tokens
///      in the deployment file to be {MockERC20} (it calls `mint`).
///
///      Env: PRIVATE_KEY (issuer/admin), DEMO_HOLDER_1, DEMO_HOLDER_2 (optional;
///      default to anvil accounts #1 and #2).
contract Seed is Script {
    uint256 internal constant RATE = 0.5e18; // 0.5 USDG per share
    uint256 internal constant SHARES_1 = 10e18; // holder 1: 10 TSLA -> 5 USDG
    uint256 internal constant SHARES_2 = 14e18; // holder 2: 14 TSLA -> 7 USDG

    struct Seeded {
        uint256 id;
        uint64 recordBlock;
        bytes32 root;
        uint256 total;
        address asset;
        address payoutToken;
        address h1;
        address h2;
        uint256 amt1;
        uint256 amt2;
        bytes32[] leaves;
    }

    function run() external {
        string memory dep = vm.readFile(_deploymentPath());
        CorporateActionRegistry registry = CorporateActionRegistry(vm.parseJsonAddress(dep, ".registry"));
        DividendDistributor distributor = DividendDistributor(vm.parseJsonAddress(dep, ".distributor"));

        Seeded memory s;
        s.asset = vm.parseJsonAddress(dep, ".tsla");
        s.payoutToken = vm.parseJsonAddress(dep, ".usdg");
        s.h1 = vm.envOr("DEMO_HOLDER_1", 0x70997970C51812dc3A010C7d01b50e0d17dc79C8);
        s.h2 = vm.envOr("DEMO_HOLDER_2", 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC);
        s.amt1 = (SHARES_1 * RATE) / 1e18; // 5e18
        s.amt2 = (SHARES_2 * RATE) / 1e18; // 7e18
        s.total = s.amt1 + s.amt2;
        // recordBlock in the immediate past so publishRoot passes in one run.
        s.recordBlock = block.number == 0 ? 0 : uint64(block.number - 1);

        address issuer = vm.parseJsonAddress(dep, ".issuer");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        // Establish holder balances (Transfer logs the CLI would read in production).
        MockERC20(s.asset).mint(s.h1, SHARES_1);
        MockERC20(s.asset).mint(s.h2, SHARES_2);

        // 1) Announce
        s.id = registry.announceAction(
            s.asset,
            ActionType.CASH_DIVIDEND,
            RATE,
            s.recordBlock,
            uint64(block.timestamp),
            uint64(block.timestamp + 7 days),
            s.payoutToken,
            "ipfs://corporax/demo/tsla-q2-2026.json"
        );

        // 2) Build snapshot root over the two holders. Assign leaf indices by
        //    ASCENDING address — the exact deterministic rule the production
        //    snapshot CLI uses — so `forge script Seed` and `pnpm snapshot`
        //    produce byte-identical artifacts and roots.
        if (uint160(s.h1) > uint160(s.h2)) {
            (s.h1, s.h2) = (s.h2, s.h1);
            (s.amt1, s.amt2) = (s.amt2, s.amt1);
        }
        s.leaves = new bytes32[](2);
        s.leaves[0] = MerkleHelper.leaf(s.id, 0, s.h1, s.amt1);
        s.leaves[1] = MerkleHelper.leaf(s.id, 1, s.h2, s.amt2);
        s.root = MerkleHelper.getRoot(s.leaves);

        // 3) Publish + 4) Fund -> CLAIMABLE
        registry.publishRoot(s.id, s.root, s.total, 2);
        MockERC20(s.payoutToken).mint(issuer, s.total);
        MockERC20(s.payoutToken).approve(address(distributor), s.total);
        distributor.fund(s.id, s.total);

        vm.stopBroadcast();

        _writeProofs(s);

        console2.log("Seeded CLAIMABLE dividend action", s.id);
        console2.log("  holder1", s.h1, s.amt1);
        console2.log("  holder2", s.h2, s.amt2);
        console2.log("  root", vm.toString(s.root));
    }

    /// @dev Writes the canonical `corporax-merkle-v1` proofs artifact by hand so we
    ///      control the exact (map-keyed-by-address) schema the frontend expects.
    function _writeProofs(Seeded memory s) internal {
        string memory head = string.concat(
            "{\n",
            '  "format": "corporax-merkle-v1",\n',
            '  "actionId": "',
            vm.toString(s.id),
            '",\n  "chainId": ',
            vm.toString(block.chainid),
            ',\n  "asset": "',
            vm.toString(s.asset),
            '",\n  "payoutToken": "',
            vm.toString(s.payoutToken),
            '",\n  "ratePerShare": "',
            vm.toString(RATE),
            '",\n  "recordBlock": ',
            vm.toString(s.recordBlock),
            ","
        );
        string memory body = string.concat(
            '\n  "merkleRoot": "',
            vm.toString(s.root),
            '",\n  "totalPayout": "',
            vm.toString(s.total),
            '",\n  "holderCount": 2,\n',
            '  "leafEncoding": ["uint256 actionId", "uint256 index", "address account", "uint256 amount"],\n',
            '  "claims": {\n',
            _claimEntry(s.h1, 0, s.amt1, MerkleHelper.getProof(s.leaves, 0)),
            ",\n",
            _claimEntry(s.h2, 1, s.amt2, MerkleHelper.getProof(s.leaves, 1)),
            "\n  }\n}\n"
        );
        string memory path = string.concat(
            vm.projectRoot(), "/../deployments/proofs-", vm.toString(block.chainid), "-", vm.toString(s.id), ".json"
        );
        vm.writeFile(path, string.concat(head, body));
        console2.log("wrote", path);
    }

    function _claimEntry(address account, uint256 index, uint256 amount, bytes32[] memory proof)
        internal
        pure
        returns (string memory)
    {
        string memory proofStr = "[";
        for (uint256 i = 0; i < proof.length; i++) {
            proofStr = string.concat(proofStr, i == 0 ? '"' : ', "', vm.toString(proof[i]), '"');
        }
        proofStr = string.concat(proofStr, "]");
        return string.concat(
            '    "',
            _toLower(vm.toString(account)),
            '": { "index": ',
            vm.toString(index),
            ', "amount": "',
            vm.toString(amount),
            '", "proof": ',
            proofStr,
            " }"
        );
    }

    /// @dev Lowercases an ASCII hex address string for stable frontend lookups.
    function _toLower(string memory str) internal pure returns (string memory) {
        bytes memory b = bytes(str);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) b[i] = bytes1(uint8(b[i]) + 32);
        }
        return string(b);
    }

    function _deploymentPath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
    }
}
