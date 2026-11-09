# Train 1 Charter (`v1.1.0`) — 9-Codec Expansion & Hub Capability Discovery

- **Project:** `Medusa` (`Jason-Vaughan/Medusa`)
- **Milestone:** [Milestone #1 (`v1.1.0 — Codec Expansion & Hub Capabilities`)](https://github.com/Jason-Vaughan/Medusa/milestone/1)
- **Target Branch:** `release/v1.1.0` (Experimental codecs isolated in `src/medusa/experiments/codecs/`)
- **Co-Signed By:** `Medusa-PM (#2)` & `Medusa-Arc (#169)`

---

## 0. Retrospective & Phase 1 Guardrails (`L1..L5`)

1. **`L1 — Zero Production Envelope Mutation`:** `WS_CONSUMER_CONTRACT.md`, HMAC-SHA256 signing, 300s replay protection, and `messageStore.js` must remain 100% untouched during codec expansion.
2. **`L2 — Canonical Semantic IR Round-Trip`:** Every experimental codec (`tuple-table-v1`, `dict-intern-v1`, `json-patch-v1`, `blackboard-ref-v1`) must normalize into `canonicalizeSemanticIR(ir)` and achieve `1.000` (`100%`) semantic fidelity across all 10 benchmark scenarios.
3. **`L3 — Authoritative State Grounding Over Syntax`:** As proven in Phase 1 Scenario 10 (`20%` syntax-only detection vs. `100%` state-grounded detection), every codec validator must verify `validateAgainstAuthoritativeState(ir, authState)`.
4. **`L4 — Pairwise Disjoint File Envelopes`:** `Envelope(Car 01-A) ∩ Envelope(Car 01-B) ∩ Envelope(Car 01-D) = ∅`.
5. **`L5 — 5-Edit Test Discipline`:** Run `cd src/medusa && npm test` before exceeding 5 edits and include full test output in the Completion Receipt (`#1889`).

---

## 1. Car Allocation & Disjoint File Envelopes (`v1.1.0`)

| Car ID | GitHub Issue | Assigned Lane | Engine | Exclusive File Envelope | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 1 Spike** | **[#71](https://github.com/Jason-Vaughan/Medusa/issues/71)** | `Medusa-PM (#2)` | `antigravity` | `src/medusa/experiments/codecs/{base-codec,nl-baseline-codec,compact-json-codec,graph-codec,graph-delta-codec,typed-command-codec}.js`, `benchmarks/agent-communication/**` | ✅ **Complete (`58e6892`)** — 5 codecs + 10-scenario harness (`269/269` Jest tests PASS). |
| **`Car 01-A`** | **[#72](https://github.com/Jason-Vaughan/Medusa/issues/72)** | `Medusa-Lane-A (#172)` | `claude` | `src/medusa/experiments/codecs/tuple-table-codec.js`, `src/medusa/experiments/codecs/dict-intern-codec.js`, `src/medusa/test/codecs-tuple-dict.test.js` | Implement `tuple-table-v1` (Positional Tuple Table) and `dict-intern-v1` (Session Symbol-Interned Dictionary) with 100% semantic round-trip fidelity and full Jest test suite. |
| **`Car 01-B`** | **[#73](https://github.com/Jason-Vaughan/Medusa/issues/73)** | `Medusa-Lane-B (#173)` | `claude` | `src/medusa/experiments/codecs/json-patch-codec.js`, `src/medusa/experiments/codecs/blackboard-ref-codec.js`, `src/medusa/test/codecs-patch-blackboard.test.js` | Implement `json-patch-v1` (RFC 6902 State-Register Diff) and `blackboard-ref-v1` (Blackboard Content-Addressed URI Reference) with content-hash verification and Jest tests. |
| **`Car 01-D`** | **[#70](https://github.com/Jason-Vaughan/Medusa/issues/70)** | `Medusa-Lane-B (#173)` *(sequential after `#73`)* | `claude` | `src/medusa/version-capabilities.js`, `src/medusa/test/version-capabilities.test.js`, additive `/api/version` route in `src/medusa/server.js` | Expose `/api/version` capability manifest + `hub:capabilities_updated` WS event on upgrade without breaking existing WS consumers. |
