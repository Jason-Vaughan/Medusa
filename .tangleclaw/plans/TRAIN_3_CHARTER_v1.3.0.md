# Train 3 Charter (`v1.3.0`) — Opt-In Codec Negotiation & Sprint Certification

- **Project:** `Medusa` (`Jason-Vaughan/Medusa`)
- **Milestone:** [Milestone #3 (`v1.3.0 — Opt-In Codec Negotiation & Sprint Certification`)](https://github.com/Jason-Vaughan/Medusa/milestone/3)
- **Target Branch:** `release/v1.3.0` -> `main`
- **Co-Signed By:** `Medusa-PM (#2)`, `Medusa-Arc (#169)`, `Medusa-INT (#170)`, & `Medusa-Obsr (#171)`

---

## 1. Car Allocation & Disjoint File Envelopes (`v1.3.0`)

| Car ID | GitHub Issue | Assigned Lane | Engine | Exclusive File Envelope | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`Car 03-A`** | **[#76](https://github.com/Jason-Vaughan/Medusa/issues/76)** | `Medusa-Lane-A (#172)` + `Medusa-INT (#170)` | `claude` + `codex` | `src/medusa/codec-negotiation.js`, `src/medusa/test/codec-negotiation.test.js`, additive opt-in `metadata.codec` hook in `src/medusa/client.js`, `WS_CONSUMER_CONTRACT.md` | Add opt-in `codecs` capability negotiation + automatic natural-language fallback (`renderForPrompt()`) for legacy/human consumers, keeping `docs-parity.test.js` 100% green. |
| **`O-Gate`** | **[#71](https://github.com/Jason-Vaughan/Medusa/issues/71)** & **[#76](https://github.com/Jason-Vaughan/Medusa/issues/76)** | `Medusa-Obsr (#171)` | `antigravity` | `sprint-reports/v1.3.0/index.html`, `roadmap-board/index.html` | Publish the full 8-section TangleClaw Sprint Report v2.0.0 with empirical 9-codec × 7-model benchmark tables and recommendation for TangleClaw production adoption. |
