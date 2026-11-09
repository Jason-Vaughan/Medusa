# Train 2 Charter (`v1.2.0`) — Cross-Model & Open-Weight Live Fleet Trials (`Monad-1 / Aider`)

- **Project:** `Medusa` (`Jason-Vaughan/Medusa`)
- **Milestone:** [Milestone #2 (`v1.2.0 — Cross-Model & Open-Weight Live Fleet Trials`)](https://github.com/Jason-Vaughan/Medusa/milestone/2)
- **Target Branch:** `release/v1.2.0`
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
| **`Car 02-A`** | **[#74](https://github.com/Jason-Vaughan/Medusa/issues/74)** | `Medusa-Lane-A (#172)` + `Medusa-Lane-C (#174)` | `claude` + `aider` | `benchmarks/agent-communication/live-model-runner.js`, `benchmarks/agent-communication/results/live-model-matrix.json`, `src/medusa/test/live-model-runner.test.js` | Execute all 9 codecs across the 4-engine + 3-open-weight model matrix and record exact token, latency, parse-failure, and retry rates. |
| **`Car 02-C`** | **[#75](https://github.com/Jason-Vaughan/Medusa/issues/75)** | `Medusa-Lane-C (#174)` + `Medusa-Obsr (#171)` | `aider` + `antigravity` | `docs/research/TANGLECLAW_AIDER_INTEGRATION_FEEDBACK.md` | Deliver actionable engineering recommendations to `TC-Lane-PM` on Aider launch flags, `OLLAMA_API_BASE` wiring, startup-control channels, and model upgrade (`gpt-oss:120b` vs `qwen3-coder-next:q4_K_M` vs `qwen3.6:35b-a3b`). |
