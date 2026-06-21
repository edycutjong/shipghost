# Security Audit Report: ShipGhost

This document outlines the security threat model, cryptographic invariants, and safety boundaries for the ShipGhost Anna Application.

---

## 1. Threat Model & Risk Profile

### 1.1. Local Source Code Leakage (High Risk)
- **Threat**: Proprietary source code changes inside git diffs are sent in plaintext to external LLM providers, violating corporate data guidelines.
- **Mitigation**: Raw git diff payloads are encrypted under an ephemeral 256-bit symmetric key (`AES-GCM-256`) within the air-gapped Executa plugin before any external transmission. Plaintext is only exposed inside the secure host execution context or processed securely under authorization tokens.

### 1.2. Clearsign Credential Abuse (Medium Risk)
- **Threat**: Unauthorized scripts invoke `pr.sign` to clearsign arbitrary or malicious markdown blocks using the developer's local GPG/SSH keys.
- **Mitigation**: The `pr.sign` tool is restricted via Anna's manifest-level permission whitelists. The iframe can only invoke approved tools registered under `tool-dev-shipghost`.

---

## 2. Cryptographic Invariants

1. **Diff Payload Encryption Invariant**:
   - Every raw git diff block passed to the host sampling model must have a corresponding SHA-256 hash envelope. The encryption key must be generated using cryptographically secure random bytes (`os.urandom(32)`).
2. **GPG Clearsign Integrity**:
   - The signed PR output block must contain standard PGP envelope headers and footers (`-----BEGIN PGP SIGNED MESSAGE-----` and `-----BEGIN PGP SIGNATURE-----`).
3. **Storage Access Control**:
   - All state written using `storage.set` must reside within the whitelisted `app` namespace, preventing cookie/token extraction from the parent browser frame.
