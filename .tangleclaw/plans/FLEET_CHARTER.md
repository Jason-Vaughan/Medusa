# Medusa Fleet Charter & Resource Pool Plan (`MEDUSA-FLEET-2026`)
*Modeled on `TC-Lane-PM` & `Zig-PM` Multi-Agent Governance Playbook (`Rule #256`, `Rule #282`, `Rule #294`, `Rule #340`, `Rule #341`)*

- **Repository:** `Jason-Vaughan/Medusa`
- **PM Coordinator:** `Medusa-PM` (`projectId: 2`, Medusa ID: `medusa-pm-b9c07259`, Engine: `antigravity` / Gemini)
- **Active Research & Engineering Initiative:** Efficient Agent-to-Agent Communication (`#71`–`#76`) + Hub Version/Capability Manifest (`#70`)
- **Single Source of Truth Index:** [MASTER_SSOT.md](https://cursatory.tail123678.ts.net:8443/plans/2/MASTER_SSOT.md) (`/Users/jasonvaughan/Documents/Projects/Medusa-PM/.tangleclaw/plans/MASTER_SSOT.md`)
- **1-Line Provisioning & Rule Activation Pack:** [FLEET_PROVISIONING_PACK.md](https://cursatory.tail123678.ts.net:8443/plans/2/FLEET_PROVISIONING_PACK.md) (`/Users/jasonvaughan/Documents/Projects/Medusa-PM/.tangleclaw/plans/FLEET_PROVISIONING_PACK.md`)

---

## 1. Resource Pool Evaluation: Why an 8-Lane, 4-Engine Topology Fits This Mission

This project is **both an engineering build and a cross-model scientific benchmark**. A standard single-engine builder pool cannot test how different model families and tokenizers (`Claude`, `Codex/GPT`, `Gemini/Antigravity`, and `Aider/Open-Weight Ollama`) encode, decode, and obey structured communication protocols.

By expanding the 7 existing Medusa lanes with **`Medusa-Lane-C` (`aider` backed by `monad-1.tail123678.ts.net:11435`)**, our **8-lane resource pool** covers **all 4 engine families** (`antigravity`, `claude`, `codex`, `aider`) and separates **Coding**, **Cross-Model Testing**, **Independent Critic Review (`R-Gate`)**, **Architecture (`A-Gate`)**, **Integration (`I-Gate`)**, and **Telemetry (`O-Gate`)**:

| Lane / Project Name | TangleClaw ID | Engine & Model Family | Role & Gate Ownership | Assigned Worktree Directory |
|---|---|---|---|---|
| **`Medusa-PM`** *(Live)* | `#2` | `antigravity` (Gemini) | **PM & Coordinator (`Rule #340`)** — Owns Charter, `MASTER_SSOT.md`, `ROADMAP.md`, GitHub Milestones/Issues, Car dispatch, and final consolidation. Never merges PRs (`Rule #282`). | `/Users/jasonvaughan/Documents/Projects/Medusa-PM` |
| **`Medusa-Arc`** | `#169` | `antigravity` (Gemini) | **Architect & Gemini Evaluator (`A-Gate`)** — Owns architectural rulings, contract/security invariants, and serves as the **Gemini Frontier Test Subject** in the 4-Engine Codec Matrix (`#74`). | `/Users/jasonvaughan/Documents/Projects/Medusa-Arc` |
| **`Medusa-PRR`** | `#168` | `codex` (OpenAI Codex) | **Independent PR Reviewer & Codex Evaluator (`R-Gate`)** — Fail-closed reviewer running the Prawduct 7-Goal Critic + 4-Goal PRR protocol on exact `headRefOid`, and serves as the **Codex Frontier Test Subject** in `#74`. | `/Users/jasonvaughan/Documents/Projects/Medusa-PRR` |
| **`Medusa-INT`** | `#170` | `codex` (OpenAI Codex) | **Integrator & Release Engineer (`I-Gate`)** — Sole session authorized to merge certified PRs (`Rule #282`, `--no-ff`), run full Node + Python test gates, and emit `W<N>-REC` wave receipts. | `/Users/jasonvaughan/Documents/Projects/Medusa-INT` |
| **`Medusa-Obsr`** | `#171` | `antigravity` (Gemini) | **Sprint Process & Benchmark Telemetry Observer (`O-Gate`)** — Non-blocking observer tracking `t1..t8` Car timestamps, token/latency metrics, Aider harness behavior (`#75`), and publishing the v2.0.0 HTML Sprint Report (`#76`). | `/Users/jasonvaughan/Documents/Projects/Medusa-Obsr` |
| **`Medusa-Lane-A`** | `#172` | `claude` (Claude Code) | **Builder Car A & Claude Evaluator** — Implements `Car 01-A` (`#72`: `tuple-table-v1` + `dict-intern-v1` codecs), `Car 02-A` (`#74`: Live 4-Engine Benchmark Adapter), and `Car 03-A` (`#76`: Opt-in Hub Codec Negotiation). Serves as the **Claude Frontier Test Subject**. | `/Users/jasonvaughan/Documents/Projects/Medusa-Lane-A` |
| **`Medusa-Lane-B`** | `#173` | `claude` (Claude Code) | **Builder Car B (Systems & Hub)** — Implements `Car 01-B` (`#73`: `json-patch-v1` + `blackboard-ref-v1` codecs) and `Car 01-D` (`#70`: Hub `GET /version` capability manifest + `hub.version_updated` broadcast). | `/Users/jasonvaughan/Documents/Projects/Medusa-Lane-B` |
| **`Medusa-Lane-C`** *(New — 8th Seat)* | *Provisioned via Pack* | `aider` (Monad-1 Open-Weight Ollama) | **Open-Weight Builder / Tester & Aider Integration Probe** — Tests all 9 codecs across Monad-1's open-weight models (`gpt-oss:120b`, `qwen3-coder-next:q4_K_M`, `qwen3.6:35b-a3b`) and produces the TangleClaw Aider Integration Feedback Report (`#75`). | `/Users/jasonvaughan/Documents/Projects/Medusa-Lane-C` |

---

## 2. Open-Weight Model Pool Discovered on `monad-1.tail123678.ts.net:11435`

Live inspection of `http://monad-1.tail123678.ts.net:11435/api/tags` confirmed **7 resident GGUF models** on Monad-1, giving `Medusa-Lane-C` (`aider`) three prime open-weight candidates to test head-to-head:

| Model Tag on Monad-1 | Architecture & Params | Quantization | Context Window | Capabilities | Role in Medusa Benchmark (`#74` & `#75`) |
|---|---|---|---|---|---|
| **`gpt-oss:120b`** *(Current `~/.aider.conf.yml` default)* | `gptoss` (`116.8B`) | `MXFP4` (65.4 GB) | `131,072` | `completion`, `tools`, `thinking` | **Baseline Open-Weight Model** — Currently configured in `~/.aider.conf.yml`. |
| **`qwen3-coder-next:q4_K_M`** *(Loaded Sept 6, 2026)* | `qwen3next` (`79.7B`) | `Q4_K_M` (51.7 GB) | `262,144` | `completion`, `tools` | **Primary Coding/DSL Challenger** — Newer coding-specialized model with 2x context window (`262K`). |
| **`qwen3.6:35b-a3b`** *(Loaded July 21, 2026)* | `qwen35moe` (`36.0B` active `3B` MoE) | `Q4_K_M` (23.9 GB) | `262,144` | `vision`, `completion`, `tools`, `thinking` | **High-Speed MoE Challenger** — Tests whether a fast 35B-A3B MoE model can reliably emit/parse `typed-cmd-v1` and `tuple-table-v1` at sub-second latency. |
| `qwen2.5:32b-instruct-q4_K_M` | `qwen2` (`32.8B`) | `Q4_K_M` (19.8 GB) | `32,768` | `completion`, `tools` | Secondary reference model. |
| `qwen3-embedding:0.6b` | `qwen3` (`595M`) | `Q8_0` (639 MB) | `32,768` | `embedding` | Available for semantic similarity / embedding drift scoring. |

---

## 3. Durable Governance & Execution Rules (`MEDUSA-FLEET-2026`)

1. **Pairwise File-Disjoint Car Bundling (`Rule #294`):**
   - Every Car within a Train has a strictly disjoint file write envelope (`Envelope(Car X) ∩ Envelope(Car Y) = ∅`) so `Medusa-Lane-A`, `Medusa-Lane-B`, and `Medusa-Lane-C` never collide on shared files.
2. **4-Gate Verification Pipeline (`R-Gate` + `A-Gate` + `I-Gate` + `O-Gate`):**
   - **`R-Gate` (`Medusa-PRR`):** Audits every PR at exact `headRefOid` under the 7-Goal Critic + 4-Goal PRR protocol (`npm test` + `pytest` green, JSDoc on all functions, `CHANGELOG.md` updated, zero out-of-scope file edits).
   - **`A-Gate` (`Medusa-Arc`):** Required whenever a Car touches wire contracts (`WS_CONSUMER_CONTRACT.md`), capability schemas (`#70`), or security/governance boundaries (`#76`).
   - **`I-Gate` (`Medusa-INT`):** Sole session authorized to merge PRs (`Rule #282`, `--no-ff`), after `R-Gate` (and `A-Gate` where applicable) `PASS` at exact `headRefOid`.
   - **`O-Gate` (`Medusa-Obsr`):** Tracks `t1..t8` timestamps and publishes the v2.0.0 Sprint Report without blocking PR merges.
3. **Production Isolation Guarantee:**
   - All experimental codec work (`#71`–`#75`) merges into `experiment/agent-communication-protocols` first. Only `#70` (Hub version/capability manifest) and `#76` (after full benchmark certification and Operator/Architect sign-off) target `main`.
