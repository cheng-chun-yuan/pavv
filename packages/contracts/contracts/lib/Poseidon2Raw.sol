// SPDX-License-Identifier: MIT
pragma solidity >=0.8.8;

import {Field} from "./Field.sol";
import {Poseidon2Lib} from "./Poseidon2Lib.sol";

/**
 * @title Poseidon2Raw
 * @notice Raw Poseidon2 permutation matching Noir's poseidon2_permutation([a, b, 0, 0], 4)[0]
 * @dev Unlike the sponge-based hash_2 in Poseidon2Lib, this applies the permutation
 *      directly to state [a, b, 0, 0] and returns state[0].
 *      This matches the SDK's poseidon2Hash2() and the Noir circuit's hash_2().
 */
library Poseidon2Raw {
    using Field for *;

    function hash2(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        Poseidon2Lib.Constants memory constants = Poseidon2Lib.load();

        Field.Type[4] memory state = [
            a.toFieldUnchecked(),
            b.toFieldUnchecked(),
            Field.Type.wrap(0),
            Field.Type.wrap(0)
        ];

        state = Poseidon2Lib.permutation(
            state,
            constants.internal_matrix_diagonal,
            constants.round_constant
        );

        return state[0].toBytes32();
    }
}
