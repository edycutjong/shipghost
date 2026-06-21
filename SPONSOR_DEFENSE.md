# Sponsor Track Defense: ShipGhost on Anna App Platform

This document justifies ShipGhost's eligibility for the **Anna AI-Native App Hackathon 2026** by citing the specific platform APIs, capabilities, and integrations utilized.

---

## 1. Whitelisted Anna SDK Methods Used (5+ Methods)

ShipGhost implements **six distinct Anna SDK methods** to coordinate its end-to-end workspace:

1. **`tools.invoke`**: Used by the frontend SPA to invoke background Python Executa tools (`git.analyze`, `pr.ghostwrite`, `commits.cleanup`, and `pr.sign`).
2. **`storage.get`**: Used on app initialization to check for saved drafts, restoring the developer's progress.
3. **`storage.set`**: Used to save draft descriptions, comment lists, and commit rewrites in the secure `app` namespace.
4. **`upload.negotiate`**: Used to initiate the upload of the final clearsigned PR Markdown bundle to R2 object storage.
5. **`sampling/createMessage`**: Used by the Executa plugin via reverse-RPC to call the host LLM, generating PR structures and commit rewrites.
6. **`window.open_view`**: Used to navigate between whitelisted app views (`main`, `inline_inspector`, `commit_cleaner`) as defined in the manifest.

---

## 2. Platform Limitations & Critiques

While building ShipGhost, we identified two platform constraints:

1. **Multiplexing Stdio on Reverse-RPC**: 
   - *Limitation*: The Executa stdio channel blocks on synchronous JSON-RPC calls. When the Executa invokes `sampling/createMessage` via reverse-RPC, it must read from stdin while the host is still waiting for the tool's result.
   - *Workaround*: We implemented a customized message dispatcher in `plugin.py` to buffer and match request IDs, but native platform support for multiplexed asynchronous lines would simplify development.
2. **Native GPG Agent Bridge**:
   - *Limitation*: The sandbox container does not bridge the host machine's `gpg-agent` socket. This prevents the plugin from prompting for local GPG passphrases, causing silent failures on clean developer environments.
   - *Workaround*: We designed a fallback simulated signature block that calculates hashes and appends keys, ensuring seamless demo execution.
