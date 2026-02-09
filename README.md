# pavv - Privacy-Preserving B2B Treasury

## The Problem

Companies using blockchain treasuries face three critical challenges:

### 1. Key Management Risk
A single private key controlling millions in company funds is a single point of failure. If the CEO's key is compromised, stolen, or lost, the entire treasury is gone. Traditional multisig helps but exposes signer identities and approval patterns on-chain.

### 2. No Transaction Privacy
Every payment, salary, vendor transaction, and strategic acquisition is visible on-chain. Competitors can track treasury flows, employees can see each other's compensation, and business strategy is exposed through spending patterns. Companies cannot adopt blockchain without the privacy guarantees they expect from traditional banking.

### 3. Auditability vs. Privacy Tradeoff
Existing privacy solutions (mixers, private chains) are all-or-nothing. Companies need selective disclosure: private from the public, but auditable by compliance teams and regulators. No current solution provides this.

## Our Solution

BLSGun solves all three with a unified cryptographic stack:

### FROST Threshold Signing (2-of-3 TSS)
- Treasury requires **2 of 3 board members** to approve any spend
- No single key can move funds
- Signing happens **inside a ZK proof** so signers are never exposed on-chain
- Supports hierarchical thresholds (HTSS) for complex org structures

### Stealth Addresses (EIP-5564 + XOR Encryption)
- Every payment uses a **one-time stealth address** - unlinkable on-chain
- **1-byte view tag** for fast scanning (rejects 255/256 non-matching events)
- **XOR-encrypted amounts** using ECDH one-time pad
- Recipients scan events with their viewing key to find payments

### Selective Auditability
- The **viewing key** can be shared with auditors, compliance platforms, or regulators
- Auditors can decrypt all transaction amounts and identify all company notes
- **Spending key stays private** - auditors can see but never move funds
- Full regulatory compliance without sacrificing privacy from the public

## Architecture

```
packages/
  sdk/         TypeScript SDK - Grumpkin curve, FROST signing, Poseidon2, stealth addresses
  circuits/    Noir ZK circuit - verifies FROST signature + note validity inside ZK
  contracts/   Solidity - BLSGun contract with Poseidon2 Merkle tree + HonkVerifier
  web/         React frontend - wallet UI with stealth balance scanning
```

### Cryptographic Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Curve | Grumpkin (embedded curve) | Native in Noir ZK circuits |
| Hash | Poseidon2 permutation | ZK-friendly, matches on-chain + off-chain |
| Signing | FROST 2-of-3 Schnorr | Threshold key management |
| Privacy | Stealth addresses (EIP-5564) | Unlinkable payments |
| Encryption | XOR one-time pad | Amount hiding |
| ZK Proof | Noir + UltraHonk | On-chain verification |

## Live Demo - Conflux eSpace Testnet

### Deployed Contracts

| Contract | Address | Explorer |
|----------|---------|----------|
| BLSGun | `0x4733E16e5465B3bBFaE5c49D98A7A979dB084e04` | [View](https://evmtestnet.confluxscan.org/address/0x4733E16e5465B3bBFaE5c49D98A7A979dB084e04) |
| HonkVerifier | `0x771DD24F8627C9e7841b88271d042D18775bE2ba` | [View](https://evmtestnet.confluxscan.org/address/0x771DD24F8627C9e7841b88271d042D18775bE2ba) |
| ZKTranscriptLib | `0xba79156aed906ec238ac845dbed75b20FA60E2E8` | [View](https://evmtestnet.confluxscan.org/address/0xba79156aed906ec238ac845dbed75b20FA60E2E8) |

**Network:** Conflux eSpace Testnet (Chain ID: 71)
**RPC:** `https://evmtestnet.confluxrpc.com`

### Demo Transactions (Full Stealth E2E)

The following transactions demonstrate the complete privacy flow on testnet:

**Step 1 - Shield (Deposit 1 CFX to Alice's stealth address):**
- Tx: [`0x9e1e0229...`](https://evmtestnet.confluxscan.org/tx/0x9e1e022968a47aef4af740edf5aadc11eee6c1d2a5823ce8ac344c62e8be39d9)
- On-chain data: commitment + ephemeral pubkey + viewTag + encrypted amount
- Only Alice's viewing key can identify this note

**Step 2 - Private Transfer (Alice -> Bob via stealth, ZK proof):**
- Tx: [`0xb42e734b...`](https://evmtestnet.confluxscan.org/tx/0xb42e734b74b609b453c8284261299800c64b41788cff44d94f5c4a5473dabd59)
- Spends Alice's note (nullifier prevents double-spend)
- Creates new note for Bob's stealth address
- FROST 2-of-3 signature verified inside ZK - no signer info on-chain

**Step 3 - Unshield (Bob withdraws 1 CFX, ZK proof):**
- Tx: [`0x9959eaaa...`](https://evmtestnet.confluxscan.org/tx/0x9959eaaa3b86b393f058817c6d5d5d22d025443528bb58b7de860b563fbcd909)
- Bob proves note ownership via FROST signature in ZK
- 1 CFX withdrawn, contract balance returns to 0

### What an on-chain observer sees vs. what actually happened

| On-chain (public) | Reality (private) |
|---|---|
| Opaque bytes32 commitment | Alice received 1,000,000 units |
| Opaque bytes32 nullifier | Alice spent her note |
| ZK proof blob (4KB) | 2-of-3 FROST signature was valid |
| New commitment for transfer | Bob received the full amount |
| Encrypted amount field | Amount hidden by XOR one-time pad |

**An observer cannot determine:** who paid, who received, how much, or which board members approved.

**An auditor with the viewing key can determine:** every transaction amount, every note belonging to the company, full transaction history - without being able to spend.

## How It Works

### Payment Flow

```
Sender                          Chain                         Recipient
  |                               |                               |
  |  1. Generate stealth addr     |                               |
  |     for recipient's meta-addr |                               |
  |                               |                               |
  |  2. shield(commitment,        |                               |
  |     ephPK, viewTag,           |                               |
  |     encryptedAmount)          |                               |
  |  ---------------------------> |                               |
  |                               |  3. Scan with viewing key     |
  |                               |  <--------------------------- |
  |                               |     viewTag fast-reject       |
  |                               |     XOR decrypt amount        |
  |                               |                               |
  |                               |  4. FROST 2-of-3 sign         |
  |                               |     (board approval)          |
  |                               |                               |
  |                               |  5. Generate ZK proof         |
  |                               |     (proves FROST sig valid)  |
  |                               |                               |
  |                               |  6. privateTransfer(          |
  |                               |     nullifier, proof,         |
  |                               |     new stealth commitment)   |
  |                               |  <--------------------------- |
```

### Stealth Address Protocol

1. Recipient publishes **stealth meta-address** = (spendingPubKey, viewingPubKey)
2. Sender generates ephemeral keypair (r, R = [r]G)
3. ECDH shared secret: S = [r]viewingPubKey
4. Stealth scalar: h = Poseidon2(S.x, S.y)
5. Stealth public key: P = [h]G + spendingPubKey
6. View tag: h & 0xFF (1 byte for fast scanning)
7. Encrypted amount: amount XOR (h & mask128)

### FROST + Stealth Integration

The key insight: Shamir secret sharing is linear. If each signer's share is `s_i`, then adding `stealthScalar` to each share gives:

```
sum(lagrange_i * (s_i + stealthScalar)) = groupSk + stealthScalar
```

This means FROST threshold signing works directly with stealth addresses - no protocol changes needed, just adjust each share by `+stealthScalar`.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Nargo](https://noir-lang.org) 1.0.0-beta.18 (Noir compiler)
- [bb](https://github.com/AztecProtocol/barretenberg) (Barretenberg prover)

### Install & Build

```bash
bun install

# SDK tests (90 tests)
cd packages/sdk && bun test

# Compile contracts
cd packages/contracts && bun run build

# Build web frontend
cd packages/web && bun run build
```

### Run Full Stealth E2E Test

**Local (hardhat node):**
```bash
# Terminal 1
cd packages/contracts && bun run node

# Terminal 2
cd packages/contracts && bun run test:stealth
```

**Conflux eSpace Testnet:**
```bash
cd packages/contracts
RPC_URL=https://evmtestnet.confluxrpc.com bun run test:stealth
```

### Deploy to Testnet

```bash
cd packages/contracts
bun run deploy:conflux-testnet
```

Requires `PRIVATE_KEY` in `packages/contracts/.env`.

## For Auditors / Compliance

A company can share its **viewing secret key** with an audit platform. The auditor can then:

1. Scan all Shield and PrivateTransfer events on-chain
2. Use the viewing key to identify which notes belong to the company
3. Decrypt all transaction amounts
4. Build a complete transaction history with inflows/outflows
5. Generate compliance reports

The viewing key **cannot spend funds**. Only the FROST threshold group (2-of-3 board members) can authorize spending.

```typescript
import { checkStealthAddress } from "@blsgun/sdk/stealth";

// Auditor scans each event
const stealthScalar = checkStealthAddress(ephemeralPK, viewTag, viewingSecretKey);
if (stealthScalar !== null) {
  // This note belongs to the company
  const amount = encryptedAmount ^ (stealthScalar & MASK_128);
  console.log("Found note, amount:", amount);
}
```
