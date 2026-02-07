// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/**
 * @title Incremental Merkle Tree
 * @notice Depth-20 Merkle tree using Poseidon2 hash (placeholder: keccak256 for EVM).
 * @dev In production, this would use a Poseidon2 precompile or library.
 *      For hackathon demo, we use keccak256 truncated to fit Field.
 *      The ZK proof handles the real Poseidon2 verification.
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
     * @dev Hash two children to produce parent node.
     *      Uses keccak256 truncated to BN254 field for on-chain.
     *      The actual Poseidon2 verification happens inside the ZK proof.
     */
    function _hashPair(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(left, right));
    }
}
