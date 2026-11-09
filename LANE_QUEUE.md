# Medusa Fleet — Canonical Lane Queue & Active Sprint Charter (`LANE_QUEUE.md`)

**Active Sprint Charter ID:** `MEDUSA-FLEET-2026-AUTONOMOUS`
**Parent Epic:** [Medusa#71 — Efficient Agent-to-Agent Communication: Structured Protocols, Graphs, State Deltas, and Latent Communication Feasibility](https://github.com/Jason-Vaughan/Medusa/issues/71)
**Base Integration Branch:** `experiment/agent-communication-protocols` (for `#71, #72, #73, #74, #75, #76`) and `main` / `experiment/agent-communication-protocols` (for `#70`)
**Operator Autonomous Go-Ahead:** Ratified `2026-11-08T21:45:49-08:00` (*"do the autonomous work - go...! use the discord to notify me on all milestones and also any blockers so i will watch from there. thank you."*)
**Registered Coordinator (`Medusa-PM`):**
- **Project ID:** `2` (`Medusa-PM`)
- **Live Session ID:** `1614`
- **Live Switchboard Workspace ID:** `medusa-pm-b9c07259`
- **Live Portal & SSOT:** `http://cursatory.tail123678.ts.net:3426/docs/MASTER_SSOT.html`

---

## 1. Active Fleet Roster & Verified Switchboard Identities

| Project ID | Project Name | Role | Engine & Model | Session ID | Switchboard Workspace ID |
|---|---|---|---|---|---|
| `#2` | `Medusa-PM` | ProjectManager (Coordinator) | `antigravity` (`gemini-4-argon`) | `#1614` | `medusa-pm-b9c07259` |
| `#169` | `Medusa-Arc` | Architect (`A-Gate` & Design) | `antigravity` (`gemini-4-argon`) | `#1623` | `medusa-arc-896eecfd` |
| `#168` | `Medusa-PRR` | Critic (`R-Gate` Independent Reviewer) | `codex` (`gpt-6-sol`) | `#1616` | `medusa-prr-ea339e40` |
| `#170` | `Medusa-INT` | Integrator (`I-Gate` & Merge Steward) | `codex` (`gpt-6-sol`) | `#1617` | `medusa-int-0f865086` |
| `#171` | `Medusa-Obsr` | Observer (`O-Gate` Telemetry & Reports) | `antigravity` (`gemini-4-argon`) | `#1625` | `medusa-obsr-8f4f476b` |
| `#172` | `Medusa-Lane-A` | Builder Lane A | `claude-sonnet-reviewer` (`claude-sonnet-5`) | `#1622` | `medusa-lane-a-f80c48d1` |
| `#173` | `Medusa-Lane-B` | Builder Lane B | `claude-sonnet-reviewer` (`claude-sonnet-5`) | `#1626` | `medusa-lane-b-d01ad9b2` |
| `#174` | `Medusa-Lane-C` | Open-Weight Lane C | `aider` (`ollama_chat/gpt-oss:120b` on Monad-1) | `#1627` | `medusa-lane-c-d2a75765` |

---

## 2. Active Sprint Trains & Disjoint Car Assignments (`MEDUSA-FLEET-2026-AUTONOMOUS`)

All cars listed below are **ACTIVE** under the Operator's autonomous sprint authorization (`MEDUSA-FLEET-2026-AUTONOMOUS`). Builders (`Medusa-Lane-A`, `Medusa-Lane-B`, `Medusa-Lane-C`), Architect (`Medusa-Arc`), Critic (`Medusa-PRR`), Integrator (`Medusa-INT`), and Observer (`Medusa-Obsr`) are authorized under their active project rules (`#340`–`#369`) to execute dispatches from `Medusa-PM` (`medusa-pm-b9c07259`) autonomously without waiting for manual human confirmation in their panes.

### Train 1 (`v1.1.0`) — Extended Codec Suite & Hub Capability Manifest (Parallel Wave 1)

| Car ID | Issue | Title | Assigned Lane | Target Base Branch | Feature Branch | Allowed Disjoint File Scope | Status |
|---|---|---|---|---|---|---|---|
| **`Car 01-A`** | [`#72`](https://github.com/Jason-Vaughan/Medusa/issues/72) | `[feature] Implement Positional Tuple Table (tuple-table-v1) & Session Symbol-Interned (dict-intern-v1) Codecs` | `Medusa-Lane-A` (`#172`) | `experiment/agent-communication-protocols` | `feat/72-tuple-and-dict-codecs` | `src/medusa/experiments/codecs/TupleTableCodec.js`<br>`src/medusa/experiments/codecs/DictionaryInternCodec.js`<br>`src/medusa/experiments/codecs/tuple-dict.test.js` | **DISPATCHED / IN PROGRESS** |
| **`Car 01-B`** | [`#73`](https://github.com/Jason-Vaughan/Medusa/issues/73) | `[feature] Implement Flat State-Register Diff (json-patch-v1) & Blackboard Artifact-Reference (blackboard-ref-v1) Codecs` | `Medusa-Lane-B` (`#173`) | `experiment/agent-communication-protocols` | `feat/73-patch-and-blackboard-codecs` | `src/medusa/experiments/codecs/JsonPatchDeltaCodec.js`<br>`src/medusa/experiments/codecs/BlackboardRefCodec.js`<br>`src/medusa/experiments/codecs/patch-blackboard.test.js` | **DISPATCHED / IN PROGRESS** |
| **`Car 01-C`** | [`#75`](https://github.com/Jason-Vaughan/Medusa/issues/75) | `[research] TangleClaw Aider & Open-Weight Integration Feedback Report (Monad-1 Model Comparison & Harness Gaps)` | `Medusa-Arc` (`#169`) + `Medusa-Lane-C` (`#174`) | `experiment/agent-communication-protocols` | `docs/75-tangleclaw-aider-feedback` | `docs/research/TANGLECLAW_AIDER_INTEGRATION_FEEDBACK.md`<br>`src/medusa/experiments/codecs/aider-feedback.test.js` | **DISPATCHED / IN PROGRESS** |

---

### Train 2 (`v1.2.0`) — Live Multi-Model & Open-Weight Evaluation Matrix + Hub Version/Capability Manifest (Wave 2)

| Car ID | Issue | Title | Assigned Lane | Target Base Branch | Feature Branch | Allowed Disjoint File Scope | Status |
|---|---|---|---|---|---|---|---|
| **`Car 02-A`** | [`#74`](https://github.com/Jason-Vaughan/Medusa/issues/74) | `[feature] Live Multi-Model & Open-Weight (Monad-1 / Aider) Evaluation Adapter & 9-Codec Matrix` | `Medusa-Lane-A` (`#172`) + `Medusa-Lane-C` (`#174`) | `experiment/agent-communication-protocols` | `feat/74-live-model-matrix` | `src/medusa/experiments/codecs/CodecRegistry.js`<br>`src/medusa/experiments/codecs/index.js`<br>`benchmarks/agent-communication/live-model-adapter.js`<br>`src/medusa/experiments/codecs/live-model-adapter.test.js`<br>`benchmarks/agent-communication/results/LIVE_MODEL_MATRIX_REPORT.md`<br>`benchmarks/agent-communication/results/BENCHMARK_REPORT.md` | **QUEUED (Wave 2)** |
| **`Car 02-B`** | [`#70`](https://github.com/Jason-Vaughan/Medusa/issues/70) | `feat(hub): expose Hub version/capability manifest and emit subscriber update notification on version/feature upgrades` | `Medusa-Lane-B` (`#173`) | `experiment/agent-communication-protocols` | `feat/70-hub-version-capability-manifest` | `src/medusa/medusa-server.js`<br>`src/medusa/medusa-server.test.js`<br>`WS_CONSUMER_CONTRACT.md`<br>`src/medusa/docs-parity.test.js` | **QUEUED (Wave 2)** |

---

### Train 3 (`v1.3.0`) — Opt-In Experimental Codec Negotiation & Sprint Report v2.0.0 (Wave 3)

| Car ID | Issue | Title | Assigned Lane | Target Base Branch | Feature Branch | Allowed Disjoint File Scope | Status |
|---|---|---|---|---|---|---|---|
| **`Car 03-A`** | [`#76`](https://github.com/Jason-Vaughan/Medusa/issues/76) | `[feature] Opt-in Experimental Codec Negotiation in MedusaServer & MedusaClient + v2.0.0 Sprint Report` | `Medusa-Lane-A` (`#172`) + `Medusa-Obsr` (`#171`) | `experiment/agent-communication-protocols` | `feat/76-opt-in-codec-negotiation` | `src/medusa/medusa-server.js`<br>`src/medusa/client/MedusaClient.js`<br>`src/medusa/medusa-server.test.js`<br>`WS_CONSUMER_CONTRACT.md`<br>`src/medusa/docs-parity.test.js`<br>`sprint-reports/v1.3.0/index.html` | **QUEUED (Wave 3)** |

---

## 3. Quality Gates & Commit Rules

1. **Standard Commit Hooks Honored:** Do NOT use `git commit --no-verify`. Both `node_modules` and `src/a2a_node/venv` are linked in every worktree so `.husky/pre-commit` (`npm test` + `pytest`) runs cleanly.
2. **JSDoc & Unit Tests:** Every function/method must have a JSDoc comment, and every Jest test file (`src/**/*.test.js`) must pass via `npx jest <test-file>`.
3. **Gate Sequence:** Builder opens PR against `experiment/agent-communication-protocols` -> `Medusa-PRR` (`R-Gate`) + `Medusa-Arc` (`A-Gate`) review -> `Medusa-INT` (`I-Gate`) merges -> `Medusa-Obsr` (`O-Gate`) records telemetry.
