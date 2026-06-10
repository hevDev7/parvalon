// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title MerkleHelper
/// @notice Test-only Merkle tree builder that is byte-for-byte compatible with
///         OpenZeppelin's {MerkleProof.verify}: pairs are hashed commutatively
///         (sorted) with keccak256, matching the on-chain verification CorporaX
///         uses. Odd nodes are promoted unchanged to the next level.
/// @dev This intentionally mirrors the *verification* rule, not the exact JS
///      `StandardMerkleTree` internal layout — any self-consistent construction
///      whose proofs fold to the root under sorted-pair hashing is valid on-chain.
///      JS↔Solidity parity of the production CLI is asserted separately in the
///      integration tests using a real generated proofs.json.
library MerkleHelper {
    /// @notice Commutative pair hash, identical to OZ MerkleProof's `_hashPair`.
    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @notice CorporaX leaf: double-keccak of abi.encode(id, index, account, amount).
    function leaf(uint256 id, uint256 index, address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(id, index, account, amount))));
    }

    /// @notice Compute the Merkle root over `leaves`.
    function getRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        require(leaves.length > 0, "no leaves");
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            uint256 nextLen = (level.length + 1) / 2;
            bytes32[] memory next = new bytes32[](nextLen);
            for (uint256 i = 0; i < level.length; i += 2) {
                next[i / 2] = (i + 1 < level.length) ? hashPair(level[i], level[i + 1]) : level[i];
            }
            level = next;
        }
        return level[0];
    }

    /// @notice Build a proof for the leaf at `index`.
    function getProof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory) {
        require(index < leaves.length, "bad index");
        bytes32[] memory scratch = new bytes32[](_maxDepth(leaves.length));
        uint256 count = 0;
        bytes32[] memory level = leaves;
        uint256 idx = index;
        while (level.length > 1) {
            uint256 sibling = idx ^ 1;
            if (sibling < level.length) {
                scratch[count++] = level[sibling];
            }
            uint256 nextLen = (level.length + 1) / 2;
            bytes32[] memory next = new bytes32[](nextLen);
            for (uint256 i = 0; i < level.length; i += 2) {
                next[i / 2] = (i + 1 < level.length) ? hashPair(level[i], level[i + 1]) : level[i];
            }
            level = next;
            idx /= 2;
        }
        bytes32[] memory proof = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            proof[i] = scratch[i];
        }
        return proof;
    }

    function _maxDepth(uint256 n) private pure returns (uint256 d) {
        uint256 x = 1;
        while (x < n) {
            x <<= 1;
            d++;
        }
        return d + 1; // headroom for promotion-driven imbalance
    }
}
