# Train 2 Charter (`v1.2.0`) — Cross-Model & Open-Weight Live Fleet Trials (`Monad-1 / Aider`)

- **Project:** `Medusa` (`Jason-Vaughan/Medusa`)
- **Milestone:** [Milestone #2 (`v1.2.0 — Cross-Model & Open-Weight Live Fleet Trials`)](https://github.com/Jason-Vaughan/Medusa/milestone/2)
- **Target Branch:** `experiment/agent-communication-protocols`
- **Co-Signed By:** `Medusa-PM (#2)`, `Medusa-Arc (#169)`, & `Medusa-Obsr (#171)`

---

## 0. Mission & Multi-Engine Test Matrix

Evaluate all **9 candidate communication codecs** across both **frontier commercial engines** (`claude`, `codex`, `antigravity`) and **local open-weight models running on `Monad-1` via `aider`** (`Medusa-Lane-C` at `http://monad-1.tail123678.ts.net:11435`):

| Engine / Seat | Model(s) Under Test | Role in Benchmark Matrix |
| :--- | :--- | :--- |
| **`claude`** (`Medusa-Lane-A`, `Medusa-Lane-B`) | Claude Sonnet / Opus | Frontier structured-synthesis & zero-shot codec compliance baseline. |
| **`codex`** (`Medusa-PRR`, `Medusa-INT`) | OpenAI Codex / GPT-5 | Frontier strict-schema & adversarial hallucination detection baseline. |
| **`antigravity`** (`Medusa-Arc`, `Medusa-Obsr`) | Gemini Pro | Frontier long-context & multi-hop relay fidelity baseline. |
| **`aider` + Monad-1** (`Medusa-Lane-C`) | `gpt-oss:120b` (`116.8B` MXFP4), `qwen3-coder-next:q4_K_M` (`79.7B`), `qwen3.6:35b-a3b` (`36B` MoE) | Open-weight syntax fragility, prompt-overhead tax, edit-block compliance, and TangleClaw Aider harness evaluation. |

---

## 1. Car Allocation & Disjoint File Envelopes (`v1.2.0`)

| Car ID | GitHub Issue | Assigned Lane | Engine | Exclusive File Envelope | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`Car 02-A`** | **[#74](https://github.com/Jason-Vaughan/Medusa/issues/74)** | `Medusa-Lane-A (#172)` + `Medusa-Lane-C (#174)` | `claude` + `aider` | `src/medusa/experiments/codecs/CodecRegistry.js`, `src/medusa/experiments/codecs/index.js`, `src/medusa/experiments/codecs/codecs.test.js`, `src/medusa/experiments/codecs/live-model-adapter.test.js`, `benchmarks/agent-communication/harness.js`, `benchmarks/agent-communication/run-benchmark.js`, `benchmarks/agent-communication/live-model-adapter.js`, `benchmarks/agent-communication/results/LIVE_MODEL_MATRIX_REPORT.md`, `benchmarks/agent-communication/results/BENCHMARK_REPORT.md`, `benchmarks/agent-communication/results/latest-results.json` | Register all 9 codecs in `CodecRegistry`, execute all 9 codecs across the 10-scenario harness + 4-engine + 3-open-weight Monad-1 model matrix, and record exact token, latency, schema-adherence, and constraint-retention metrics. |
| **`Car 02-B`** | **[#70](https://github.com/Jason-Vaughan/Medusa/issues/70)** | `Medusa-Lane-B (#173)` | `claude` | `src/medusa/medusa-server.js`, `src/medusa/medusa-server.test.js`, `WS_CONSUMER_CONTRACT.md`, `src/medusa/docs-parity.test.js` | **MERGED (`PR #80` @ `0f294ec`)** — Expose Hub version/capability manifest (`GET /version`, `GET /health`, WS `registered`) and `hub.version_updated` broadcast. |
| **`Car 01-C / 02-C`** | **[#75](https://github.com/Jason-Vaughan/Medusa/issues/75)** | `Medusa-Lane-C (#174)` + `Medusa-Arc (#169)` | `aider` + `antigravity` | `docs/research/TANGLECLAW_AIDER_INTEGRATION_FEEDBACK.md`, `src/medusa/experiments/codecs/aider-feedback.test.js` | **MERGED (`PR #77` @ `0a51f37`)** — Deliver empirical Monad-1 3-model comparison + Aider integration report (`TangleClaw#2961`). |
