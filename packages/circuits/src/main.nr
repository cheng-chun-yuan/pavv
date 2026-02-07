// BLSGun: Privacy-Preserving B2B Treasury -- Noir ZK Circuit
//
// Proves transaction validity AND FROST Schnorr signature validity
// entirely inside ZK. On-chain verifier sees NOTHING about signers,
// amounts, or recipients.
//
// Grumpkin is Noir's native embedded curve -- Schnorr verification
// costs ~1,500 constraints. Total circuit: ~3,000-5,000 constraints.

use std::embedded_curve_ops::{
    EmbeddedCurvePoint, EmbeddedCurveScalar, embedded_curve_add, fixed_base_scalar_mul,
    multi_scalar_mul,
};

// Merkle tree depth (must match SDK TREE_DEPTH)
global TREE_DEPTH: u32 = 20;

// -- Helper: Poseidon2 Hash Wrappers --
// Uses raw poseidon2_permutation with state size 4.
// Must match hash.ts poseidon2Hash2/3/4 exactly.

fn hash_2(a: Field, b: Field) -> Field {
    std::hash::poseidon2_permutation([a, b, 0, 0], 4)[0]
}

fn hash_3(a: Field, b: Field, c: Field) -> Field {
    std::hash::poseidon2_permutation([a, b, c, 0], 4)[0]
}

fn hash_4(a: Field, b: Field, c: Field, d: Field) -> Field {
    std::hash::poseidon2_permutation([a, b, c, d], 4)[0]
}

// -- Main Circuit --

fn main(
    // === Private inputs (ALL hidden from on-chain) ===

    // FROST Schnorr signature components
    signature_R_x: Field,
    signature_R_y: Field,
    signature_z: Field,
    group_pubkey_x: Field,
    group_pubkey_y: Field,

    // Transaction private data
    spending_key_hash: Field,
    note_amount: Field,
    note_blinding: Field,
    merkle_path: [Field; TREE_DEPTH],
    merkle_indices: [Field; TREE_DEPTH],

    // === Public inputs (visible on-chain, but reveal nothing) ===
    nullifier: pub Field,
    commitment: pub Field,
    merkle_root: pub Field,
) {
    // ========================================
    // 1. VERIFY NULLIFIER (prevents double-spend)
    // ========================================
    // nullifier = hash_2(spending_key_hash, leaf_index)
    let computed_nullifier = hash_2(spending_key_hash, merkle_indices[0]);
    assert(computed_nullifier == nullifier, "Nullifier mismatch");

    // ========================================
    // 2. VERIFY COMMITMENT (proves value knowledge)
    // ========================================
    // commitment = hash_3(spending_key_hash, note_amount, note_blinding)
    let computed_commitment = hash_3(spending_key_hash, note_amount, note_blinding);
    assert(computed_commitment == commitment, "Commitment mismatch");

    // ========================================
    // 3. VERIFY MERKLE MEMBERSHIP (note exists in tree)
    // ========================================
    let mut current = computed_commitment;
    for i in 0..TREE_DEPTH {
        let path_element = merkle_path[i];
        let index = merkle_indices[i];

        // index == 0 means current node is on the left
        // index == 1 means current node is on the right
        let (left, right) = if index == 0 {
            (current, path_element)
        } else {
            (path_element, current)
        };
        current = hash_2(left, right);
    }
    assert(current == merkle_root, "Merkle root mismatch");

    // ========================================
    // 4. FROST SCHNORR SIGNATURE VERIFICATION
    // ========================================
    // Bind the signature to this specific transaction
    let message = hash_2(nullifier, commitment);

    // Challenge: c = hash_2(hash_4(R.x, R.y, PK.x, PK.y), message)
    // Must match hashChallenge() in signer.ts exactly
    let c_inner = hash_4(signature_R_x, signature_R_y, group_pubkey_x, group_pubkey_y);
    let c = hash_2(c_inner, message);

    // Schnorr verification: [z]G == R + [c]PK
    // z scalar for fixed_base_scalar_mul (Grumpkin native)
    let z_scalar = EmbeddedCurveScalar { lo: signature_z, hi: 0 };
    let lhs = fixed_base_scalar_mul(z_scalar);

    // [c]PK using multi_scalar_mul
    let pk_point = EmbeddedCurvePoint {
        x: group_pubkey_x,
        y: group_pubkey_y,
        is_infinite: false,
    };
    let c_scalar = EmbeddedCurveScalar { lo: c, hi: 0 };
    let c_pk = multi_scalar_mul([pk_point], [c_scalar]);

    // R + [c]PK
    let r_point = EmbeddedCurvePoint {
        x: signature_R_x,
        y: signature_R_y,
        is_infinite: false,
    };
    let rhs = embedded_curve_add(r_point, c_pk);

    // Assert [z]G == R + [c]PK (FROST signature valid!)
    assert(lhs.x == rhs.x, "FROST sig x mismatch");
    assert(lhs.y == rhs.y, "FROST sig y mismatch");
}

// -- Tests --

#[test]
fn test_hash_determinism() {
    let h1 = hash_2(1, 2);
    let h2 = hash_2(1, 2);
    assert(h1 == h2, "Hash should be deterministic");
}

#[test]
fn test_hash_different_inputs() {
    let h1 = hash_2(1, 2);
    let h2 = hash_2(1, 3);
    assert(h1 != h2, "Different inputs should give different hashes");
}

#[test]
fn test_schnorr_point_ops() {
    // Basic test: [1]G should produce a valid point
    let scalar = EmbeddedCurveScalar { lo: 1, hi: 0 };
    let point = fixed_base_scalar_mul(scalar);
    assert(!point.is_infinite, "Generator should not be at infinity");

    // [2]G = G + G
    let scalar2 = EmbeddedCurveScalar { lo: 2, hi: 0 };
    let double_g = fixed_base_scalar_mul(scalar2);
    let g_plus_g = embedded_curve_add(point, point);
    assert(double_g.x == g_plus_g.x, "2G should equal G+G (x)");
    assert(double_g.y == g_plus_g.y, "2G should equal G+G (y)");
}
