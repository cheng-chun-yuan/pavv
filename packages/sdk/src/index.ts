/**
 * BLSGun SDK — Privacy-Preserving B2B Treasury
 *
 * Public API for key generation, FROST threshold signing,
 * stealth addresses, transaction construction, and ZK proving.
 */

// Types
export type {
  GrumpkinPoint,
  KeyShare,
  NoncePair,
  SignerKeyMaterial,
  MasterKeyPackage,
  HierarchicalKeyPackage,
  Note,
  CommitmentLeaf,
  MerkleProof,
  UnsignedTransaction,
  FrostSignature,
  PartialSignature,
  SignedTransaction,
  StealthMetaAddress,
  StealthAddress,
  SigningSession,
  AuditTransaction,
  AuditReport,
  CircuitInputs,
} from "./types.js";

// Poseidon2 hashing (matches Noir circuit)
export {
  initHash,
  poseidon2Hash2,
  poseidon2Hash3,
  poseidon2Hash4,
} from "./hash.js";

// Grumpkin curve utilities
export {
  GRUMPKIN_ORDER,
  GRUMPKIN_BASE_FIELD_ORDER,
  G,
  ZERO,
  Fr,
  Fp,
  scalarMul,
  pointAdd,
  pointNeg,
  pointEqual,
  toAffine,
  fromAffine,
  randomScalar,
  modInverse,
  modAdd,
  modMul,
  modSub,
} from "./grumpkin.js";

// Key generation
export {
  shamirSplit,
  shamirReconstruct,
  precomputeNonces,
  generateMasterKeyPackage,
  createSignerKeyMaterial,
  evaluateDerivative,
  hierarchicalSplit,
  generateHierarchicalKeyPackage,
} from "./keygen.js";

// FROST signing
export {
  hashChallenge,
  lagrangeCoeff,
  createSigningSession,
  registerNonceCommitment,
  frostPartialSign,
  frostAggregate,
  frostVerify,
  frostSign,
  frostHierarchicalPartialSign,
  frostHierarchicalSign,
} from "./signer.js";

// Birkhoff interpolation (hierarchical threshold)
export {
  fallingFactorial,
  buildBirkhoffMatrix,
  gaussianEliminate,
  birkhoffCoeff,
  birkhoffReconstruct,
  isBirkhoffPoised,
} from "./birkhoff.js";
export type { BirkhoffParticipant } from "./birkhoff.js";

// Transaction construction
export {
  TREE_DEPTH,
  computeCommitment,
  computeNullifier,
  computeTransactionMessage,
  createNote,
  MerkleTree,
  verifyMerkleProof,
  buildTransaction,
  buildCircuitInputs,
} from "./transaction.js";

// Stealth addresses
export {
  createStealthMetaAddress,
  generateStealthAddress,
  checkStealthAddress,
  computeStealthSpendingKey,
} from "./stealth.js";

// Audit
export {
  generateAuditReport,
  exportAuditJSON,
} from "./audit.js";

// Distributed key ceremony
export {
  distributedCeremony,
  verifyShareAgainstCommitments,
  clearSecret,
} from "./ceremony.js";
export type {
  CeremonyConfig,
  CeremonyShare,
  CeremonyResult,
} from "./ceremony.js";

// Nonce tracker
export { NonceTracker } from "./nonce-tracker.js";

// Prover (optional — requires nargo/bb CLI)
export {
  compileCircuit,
  generateProof,
  readPublicInputs,
  generateVerificationKey,
  generateSolidityVerifier,
  verifyProof,
} from "./prover.js";
