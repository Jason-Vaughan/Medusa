# TangleClaw + Medusa Experimental Codec Integration Specification

- **Issue:** [Medusa #71](https://github.com/Jason-Vaughan/Medusa/issues/71)
- **Branch:** `experiment/agent-communication-protocols`
- **Status:** Specification Only — **No TangleClaw production code is modified in this spike.**

---

## 1. Purpose & Authority Boundary

This specification defines how TangleClaw (`tc message send`, `tc message read`, `/api/sessions/:project/medusa/*`) and Medusa (`MedusaServer`, `MedusaClient`) will integrate experimental communication codecs (`typed-cmd-v1`, `compact-json-v1`, `graph-delta-v1`) once empirical benchmarks justify a live multi-agent pilot.

### Strict Authority Separation
1. **TangleClaw Owns Project & Execution State:**
   - TangleClaw remains the sole source of truth for:
     - Project, fleet, and session lifecycle state (`tc sessions`, `tc workload`)
     - Governance holds and stops (`tc control`, Rule #256)
     - Merge-role authorization (`Rule #282`, `tc merge-gate`)
     - Chunk-Boundary Protocol receipts (`TangleClaw#1889`, `lib/chunk-boundary.js`)
     - Durable send idempotency wake reconciliation (`TangleClaw#2323` + `Medusa#67`)
2. **Medusa Owns Transport, Codec Negotiation & Wire Validation:**
   - Medusa remains responsible for:
     - Store-and-forward durable queueing (`offlineQueues`, `idempotencyRecords`)
     - Codec capability advertisement (`Medusa#70` `GET /version` / `capabilities`)
     - Envelope schema validation, lossless encode/decode, delta state digest checks, and deterministic `humanAuditText` generation.
   - **Invariant:** A graph node or typed command transported over Medusa is **a communication claim from `sender` to `recipient`**, never an unverified mutation of TangleClaw's SQLite database. TangleClaw's runtime validators (`validateNextChunkDispatch`, `merge-gate`, `control`) always verify claims against Git and SQLite reality.

---

## 2. Backward-Compatible Wire Envelope

To preserve 100% compatibility with existing `MedusaClient` consumers and `WS_CONSUMER_CONTRACT.md`:

```json
{
  "id": "8e8c3f1a-4b10-4b2c-98a0-91a2b3c4d5e6",
  "type": "direct",
  "from": "medusa-pm-b9c07259",
  "to": "medusa-prr-609c6a7d",
  "idempotencyKey": "tc-msg-1614-0042",
  "timestamp": "2026-11-09T01:45:00.000Z",
  "message": "!v1 review.request id=\"msg-42\" from=\"Medusa-Lane-A\" to=\"Medusa-PRR\" issue=[67] pr=69 repo=\"Jason-Vaughan/Medusa\" base=\"main\" head=\"4c3d6bc\" scope=[\"src/medusa/medusa-server.js\"] tests=\"15/15:252/252\"",
  "codecEnvelope": {
    "codec": "typed-cmd-v1",
    "schemaVersion": "1.0.0",
    "wireText": "!v1 review.request id=\"msg-42\" ...",
    "humanAuditText": "[review.request] Medusa-Lane-A -> Medusa-PRR | PR #69 (issue #67) @ 4c3d6bc on Jason-Vaughan/Medusa (base: main) | tests: 15/15:252/252 | scope: src/medusa/medusa-server.js"
  }
}
```

### Key Compatibility Rules
1. **Legacy Clients Keep Working:** Any consumer that only reads `msgPayload.message` receives either `humanAuditText` (when `preferHumanFallback: true`) or the self-contained `wireText`.
2. **Idempotency Preservation (`Medusa#67`):** `matchesIdempotencyRecord()` compares the canonical request payload (`from`, `to`, `message`, and optional `codecEnvelope.codec` + `codecEnvelope.wireText`), ensuring idempotent retries (`200 OK`, `replayed: true`) and conflicting reuse checks (`409 IDEMPOTENCY_KEY_CONFLICT`) behave identically across all codecs.
3. **Human Audit Surface:** TangleClaw's UI and `tc capture` / `tc message read --audit` can always display `codecEnvelope.humanAuditText`, while the prompt injected into an LLM pane uses the token-optimized `codecEnvelope.wireText`.

---

## 3. Target TangleClaw Integration Test Workflows

When advancing to Phase 2 live fleet validation, the integration test suite will execute 7 canonical TangleClaw workflows across `nl-baseline-v1`, `typed-cmd-v1`, `compact-json-v1`, and `graph-delta-v1`:

1. **Workflow 1 — PM Assigns Work to Builder (`task.assign` -> `task.ack`):**
   - `Medusa-PM` dispatches a 2-issue bundled car (`Rule #294`) with explicit `allowedFiles`, `baseSha`, `branch`, and `constraints`.
   - `Medusa-Lane-A` decodes the envelope, verifies zero constraint loss, and replies with `task.ack`.
2. **Workflow 2 — Builder Reports Completion (`chunk.receipt`):**
   - `Medusa-Lane-A` emits a structured completion receipt naming `pr`, `headRefOid`, `testSummary`, `filesChanged`, and `clearance: "safe-to-clear"`.
3. **Workflow 3 — PR Reviewer Requests Revisions (`review.request` -> `review.findings` HOLD -> Round 2 `review.findings` PASS):**
   - `Medusa-PM` dispatches `Medusa-PRR` with the full formal envelope (`repository`, `base`, `head`, `headRefOid`, `pr`, `tests`, `scope`).
   - `Medusa-PRR` returns structured findings (`severity`, `file`, `line`, `summary`, `verdict: "HOLD"`), followed by Builder fix and Round 2 `PASS`.
4. **Workflow 4 — Architect Issues Binding Decision (`decision.escalate` -> `decision.verdict`):**
   - Builder escalates a governance/ADR question; `Medusa-Arc` returns an A-Gate `PASS` or `HOLD` referencing the governing ADR/Rule and exact commit SHA.
5. **Workflow 5 — PM Reassigns Resources / Engine Rebind (`state.update`):**
   - `Medusa-PM` updates lane assignment and engine binding at a chunk boundary after verifying `safe-to-clear`.
6. **Workflow 6 — Multi-Builder Dependency & Collision Negotiation (`dependency.notify`):**
   - `Medusa-Lane-A` and `Medusa-Lane-B` exchange dependency readiness and detect overlapping file scope before edit collision occurs.
7. **Workflow 7 — Fleet Recovery After Disconnect or Missed Update (`state.resync`):**
   - Simulates a Builder or Reviewer reconnecting after missing 3 intermediate state deltas; verifies deterministic detection (`MISSING_BASE_VERSION`), snapshot/delta replay, and idempotent message reconciliation via `GET /messages/receipts/:idempotencyKey`.

---

## 4. Shared Graph Ownership Rules (If `graph-delta-v1` Is Enabled)

If `graph-delta-v1` is used for multi-agent sprint state compression:
1. **Single Writer per Partition or Coordinator-Sequenced Version:**
   - The PM (`Medusa-PM`) owns the canonical wave version counter ($v_0, v_1, \dots, v_n$) and state digest for the sprint's coordination graph.
   - Builders submit delta proposals against their last known `baseVersion` + `baseDigest`.
   - If two Builders submit concurrent deltas against the same `baseVersion` that touch disjoint nodes/edges, the coordinator deterministically merges them into $v_{n+1}$; if they touch the same node/edge with conflicting values, `GraphDeltaCodec` raises a `VERSION_CONFLICT` requiring explicit coordinator resolution.
2. **Ephemeral Scope:**
   - The shared communication graph is scoped to a single sprint wave and pruned on wave completion so sensitive or stale context never accumulates across sprints.
