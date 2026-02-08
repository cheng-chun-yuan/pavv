// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Poseidon2Raw} from "./lib/Poseidon2Raw.sol";

/**
 * @title Incremental Merkle Tree
 * @notice Depth-20 Merkle tree using Poseidon2 hash (raw permutation mode).
 * @dev Uses Poseidon2Raw which matches Noir's poseidon2_permutation([a,b,0,0],4)[0]
 *      and the SDK's poseidon2Hash2(a, b).
 */
contract MerkleTree {
    uint256 public constant TREE_DEPTH = 20;
    uint256 public constant MAX_LEAVES = 2 ** TREE_DEPTH;

    // Zero hashes for empty subtrees at each level
    bytes32[21] public zeroHashes;

    // Filled subtrees (one per level)
    bytes32[21] public filledSubtrees;

    // Current number of leaves
    uint256 public nextLeafIndex;

    // Current root
    bytes32 public root;

    constructor() {
        // Initialize zero hashes
        zeroHashes[0] = bytes32(0);
        for (uint256 i = 1; i <= TREE_DEPTH; i++) {
            zeroHashes[i] = _hashPair(zeroHashes[i - 1], zeroHashes[i - 1]);
        }

        // Initialize filled subtrees
        for (uint256 i = 0; i <= TREE_DEPTH; i++) {
            filledSubtrees[i] = zeroHashes[i];
        }

        root = zeroHashes[TREE_DEPTH];
    }

    /**
     * @notice Insert a new leaf into the Merkle tree
     * @param leaf The commitment to insert
     * @return index The index of the inserted leaf
     */
    function _insertLeaf(bytes32 leaf) internal returns (uint256 index) {
        require(nextLeafIndex < MAX_LEAVES, "Merkle tree is full");

        index = nextLeafIndex;
        uint256 currentIndex = index;
        bytes32 currentHash = leaf;

        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            if (currentIndex % 2 == 0) {
                // Current node is left child
                filledSubtrees[i] = currentHash;
                currentHash = _hashPair(currentHash, zeroHashes[i]);
            } else {
                // Current node is right child
                currentHash = _hashPair(filledSubtrees[i], currentHash);
            }
            currentIndex = currentIndex / 2;
        }

        root = currentHash;
        nextLeafIndex = index + 1;
    }

    /**
     * @dev Hash two children to produce parent node using Poseidon2 raw permutation.
     *      Matches Noir circuit's hash_2(left, right) exactly.
     */
    function _hashPair(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return Poseidon2Raw.hash2(left, right);
    }
}
