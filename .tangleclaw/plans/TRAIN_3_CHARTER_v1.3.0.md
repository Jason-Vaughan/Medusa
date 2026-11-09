# Train 3 Charter (`v1.3.0`) — Opt-In Codec Negotiation & Sprint Certification

- **Project:** `Medusa` (`Jason-Vaughan/Medusa`)
- **Milestone:** [Milestone #3 (`v1.3.0 — Opt-In Codec Negotiation & Sprint Certification`)](https://github.com/Jason-Vaughan/Medusa/milestone/3)
- **Target Branch:** `experiment/agent-communication-protocols`
- **Co-Signed By:** `Medusa-PM (#2)`, `Medusa-Arc (#169)`, `Medusa-INT (#170)`, & `Medusa-Obsr (#171)`

---

## 1. Car Allocation & Disjoint File Envelopes (`v1.3.0`)

| Car ID | GitHub Issue | Assigned Lane | Engine | Exclusive File Envelope | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`Car 03-A`** | **[#76](https://github.com/Jason-Vaughan/Medusa/issues/76)** | `Medusa-Lane-B (#173)` | `claude` | `src/medusa/medusa-server.js`, `src/medusa/client/MedusaClient.js`, `src/medusa/medusa-server.test.js`, `WS_CONSUMER_CONTRACT.md`, `src/medusa/docs-parity.test.js` | Add opt-in `codec` / `codecEnvelope` / `canonicalMessage` capability negotiation on `POST /messages/direct` and `MedusaClient`, preserve `humanAuditText` fallback in `msgPayload.message`, maintain 100% `Medusa#67` idempotency parity, and keep `docs-parity.test.js` 100% green. |
| **`O-Gate`** | **[#71](https://github.com/Jason-Vaughan/Medusa/issues/71)** & **[#76](https://github.com/Jason-Vaughan/Medusa/issues/76)** | `Medusa-Obsr (#171)` | `antigravity` | `sprint-reports/v1.3.0/index.html`, `roadmap-board/index.html` | Publish the full TangleClaw Sprint Report v2.0.0 (`sprint-reports/v1.3.0/index.html`) with empirical 9-codec × multi-model benchmark tables and recommendation for TangleClaw production adoption. |
