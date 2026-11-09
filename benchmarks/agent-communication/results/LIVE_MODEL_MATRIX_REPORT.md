# Live Multi-Model & Open-Weight Evaluation Matrix (`#74`)

- **Issue:** [Jason-Vaughan/Medusa#74](https://github.com/Jason-Vaughan/Medusa/issues/74)
- **Mode:** `offline-deterministic`
- **Generated At:** `2026-11-09T07:03:06.016Z`

> Frontier profiles (`claude`, `codex`, `antigravity`) have no live completion endpoint wired into this harness and are always scored deterministically against each codec's own encode/decode output (`mode: frontier-deterministic`) as a reproducible upper-bound baseline. Only the three Monad-1 open-weight models are queried live over HTTP when run with `offline: false`.

## 1. Per-Model, Per-Codec Matrix

| Model/Profile | Codec | Mode | Schema Adherence | Constraint Retention | Round-Trip Semantic | Prompt Tokens | Eval Tokens | Wall (ms) | Eval (ms) | Tok/s |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `claude` | `nl-baseline-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `codex` | `nl-baseline-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `antigravity` | `nl-baseline-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `gpt-oss:120b` | `nl-baseline-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3-coder-next:q4_K_M` | `nl-baseline-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3.6:35b-a3b` | `nl-baseline-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `claude` | `compact-json-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `codex` | `compact-json-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `antigravity` | `compact-json-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `gpt-oss:120b` | `compact-json-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3-coder-next:q4_K_M` | `compact-json-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3.6:35b-a3b` | `compact-json-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `claude` | `graph-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `codex` | `graph-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `antigravity` | `graph-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `gpt-oss:120b` | `graph-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3-coder-next:q4_K_M` | `graph-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3.6:35b-a3b` | `graph-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `claude` | `graph-delta-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `codex` | `graph-delta-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `antigravity` | `graph-delta-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `gpt-oss:120b` | `graph-delta-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3-coder-next:q4_K_M` | `graph-delta-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3.6:35b-a3b` | `graph-delta-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `claude` | `typed-cmd-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `codex` | `typed-cmd-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `antigravity` | `typed-cmd-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `gpt-oss:120b` | `typed-cmd-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3-coder-next:q4_K_M` | `typed-cmd-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3.6:35b-a3b` | `typed-cmd-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `claude` | `tuple-table-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `codex` | `tuple-table-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `antigravity` | `tuple-table-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `gpt-oss:120b` | `tuple-table-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3-coder-next:q4_K_M` | `tuple-table-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3.6:35b-a3b` | `tuple-table-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `claude` | `dict-intern-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `codex` | `dict-intern-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `antigravity` | `dict-intern-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `gpt-oss:120b` | `dict-intern-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3-coder-next:q4_K_M` | `dict-intern-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3.6:35b-a3b` | `dict-intern-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `claude` | `json-patch-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `codex` | `json-patch-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `antigravity` | `json-patch-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `gpt-oss:120b` | `json-patch-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3-coder-next:q4_K_M` | `json-patch-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3.6:35b-a3b` | `json-patch-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `claude` | `blackboard-ref-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `codex` | `blackboard-ref-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `antigravity` | `blackboard-ref-v1` | `frontier-deterministic` | 100% | 100% | 100% | – | – | – | – | – |
| `gpt-oss:120b` | `blackboard-ref-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3-coder-next:q4_K_M` | `blackboard-ref-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |
| `qwen3.6:35b-a3b` | `blackboard-ref-v1` | `offline` | 100% | 100% | 100% | – | – | – | – | – |

---

## 2. Real Monad-1 Decode-Rate Reference (from `docs/research/TANGLECLAW_AIDER_INTEGRATION_FEEDBACK.md`)

Measured (not simulated) Suite A/B decode rates against `http://monad-1.tail123678.ts.net:11435/api/chat` (`temperature: 0`), evaluated by `Medusa-Lane-C` under `#75`:

| Model | Setting | Decode Rate | End-to-End Eval Duration | Note |
|---|---|---:|---:|---|
| `gpt-oss:120b` | `num_predict: 600` | `25.78 tok/s` | `11,171 ms` | Needs the larger cap: `~200` of its tokens are hidden reasoning before the visible 88-token answer. |
| `qwen3-coder-next:q4_K_M` | `num_predict: 220` | `28.10 tok/s` | `3,132 ms` | Zero hidden reasoning tokens — `3.57x` shorter end-to-end duration than `gpt-oss:120b`. |
| `qwen3.6:35b-a3b` | `think: false`, `num_predict: 220` | `33.83 tok/s` | `2,986 ms` | Highest decode rate observed; fails closed to empty output if `think` is left at its `true` default under a tight token cap. |

**Implication for this matrix:** a live (`offline: false`) run against `qwen3-coder-next:q4_K_M` or `qwen3.6:35b-a3b` (`think: false`) should set `num_predict` high enough to avoid truncating a codec reply mid-structure, and `gpt-oss:120b` should either use `think: false` or budget for its hidden reasoning tokens.
