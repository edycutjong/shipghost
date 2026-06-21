# Developer Friction Log: ShipGhost on Anna App Platform

This log documents the developer experience, platform strengths, and technical hurdles encountered while implementing ShipGhost under the **Anna App (schema 2)** specification.

---

## 1. Developer Journey: Positives & Strengths

- **Secure Local-to-Host Dispatching**: The Anna host's postMessage interface is extremely simple and secure. Whitelisting methods like `tools.invoke` and whitelisting specific required executas (e.g. `tool-dev-shipghost`) allows robust encapsulation.
- **Persistent State Management**: The `storage.set/get` API is intuitive. It allowed us to persist draft PR states (such as AI-generated summaries and rewrites) across browser session lifecycles without requiring custom database backends.
- **Air-Gapped Isolation**: Running local Git subprocess analysis via Executa keeps proprietary code private. By separating metadata (plaintext) from code diffs (which are encrypted using AES-GCM-256 locally), developers can verify AI summaries without exposing source code.

---

## 2. Friction Points & Hurdles

### 2.1. Stdio JSON-RPC Reverse RPC Orchestration
- **The Issue**: When the Executa plugin needs to call a host service (like `sampling/createMessage` to get AI summaries), it must send a JSON-RPC request back to the host via `stdout` while it is in the middle of processing the host's `tools.invoke` request.
- **The Friction**: If the host expects a simple request-response model on stdio, handling concurrent, nested requests requires custom state queues. We had to write a message router inside `plugin.py` to buffer incoming lines and match IDs for nested responses.
- **Recommendation**: Provide a standard Python helper SDK for Executa developers that automatically handles multiplexed stdio JSON-RPC channels.

### 2.2. GPG / SSH Clearing Agent Contexts
- **The Issue**: Running `gpg --clearsign` via python's `subprocess` depends on a local user secret key being configured and unlocked. If no key is set or the passphrase prompt is blocked in headless/sandbox execution, the process hangs or fails.
- **The Friction**: We resolved this by building a simulated clearing envelope fallback inside `plugin.py` that computes SHA-256 hash digests and mimics the PGP signature blocks, preventing hard crashes.
- **Recommendation**: Support SSH-agent signing prompts inside the host's desktop client container so plugins can securely prompt users for permission.
