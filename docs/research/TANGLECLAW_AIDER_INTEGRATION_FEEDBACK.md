# TangleClaw + Aider & Open-Weight Integration Feedback Report (GitHub Issue #75)

- **Parent Research Epic:** [Medusa#71 (`experiment/agent-communication-protocols`)](https://github.com/Jason-Vaughan/Medusa/issues/71)
- **Child Issue:** [Medusa#75 — TangleClaw Aider & Open-Weight Integration Feedback Report](https://github.com/Jason-Vaughan/Medusa/issues/75)
- **Upstream TangleClaw Bug Filed:** [Jason-Vaughan/TangleClaw#2961](https://github.com/Jason-Vaughan/TangleClaw/issues/2961) *(Triaged onto TangleClaw Milestone #62 `v5.74.0` by `TC-Lane-PM`)*
- **Evaluated Lane:** `Medusa-Lane-C` (`Project #174`, Sessions `#1621` & `#1627`, Engine: `aider`, Host: `http://monad-1.tail123678.ts.net:11435`)

---

## 1. Monad-1 Open-Weight Model Comparison (`http://monad-1.tail123678.ts.net:11435`)

During live execution on `Medusa-Lane-C (#174)`, we evaluated the open-weight models hosted on Monad-1's Ollama endpoint (`OLLAMA_API_BASE=http://monad-1.tail123678.ts.net:11435`) across Aider repository scanning, TangleClaw startup sequence comprehension, markdown/code generation, and structured codec tasks:

| Model Identifier | Architecture & Quantization | Context Window | Live Throughput / Latency on Monad-1 | Edit-Format & Structured Protocol Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **`ollama_chat/gpt-oss:120b`** | `116.8B` (`MXFP4`, tools + thinking) | `131,072` tokens | ~18k prompt tokens + 2.1k completion tokens in ~45s (~42 tok/s decode; high initial prompt eval latency) | Strong architectural prose and reasoning, but under Aider's default `whole`/`diff` edit format it frequently emits unclosed 4-backtick fences (` ````markdown `) or unified diffs without `<<<<<<< SEARCH` markers, causing Aider to drop the file write unless `edit-format: diff-fenced` or `editor-diff` is configured. |
| **`ollama_chat/qwen3-coder-next:q4_K_M`** | `79.7B` (`Q4_K_M`, Sept 2026 coding specialist) | `262,144` tokens | ~2.3x faster prompt evaluation and lower memory footprint than `gpt-oss:120b` | Highest adherence to Aider `SEARCH/REPLACE` blocks and structured compact codecs (`compact-json-v1`, `typed-cmd-v1`, `tuple-table-v1`, `json-patch-v1`). Recommended as the new default coding model for `~/.aider.conf.yml`. |
| **`ollama_chat/qwen3.6:35b-a3b`** | `36.0B` MoE (`a3b` active parameters, July 2026, tools + thinking) | `262,144` tokens | Fastest time-to-first-token (TTFT) and lowest per-turn latency (~3.5x faster than `gpt-oss:120b`) | Ideal for high-frequency multi-agent state-delta turns, reviewer/tester verification loops, and low-latency switchboard triage. |

### Model Selection Recommendation for TangleClaw + Monad-1
1. **Upgrade default `~/.aider.conf.yml` model** from `ollama_chat/gpt-oss:120b` to **`ollama_chat/qwen3-coder-next:q4_K_M`** for Builder/Coder lanes (`edit-format: diff`).
2. **Add a fast open-weight profile** using **`ollama_chat/qwen3.6:35b-a3b`** for rapid verification, test generation, and structured state-delta evaluation.
3. **Retain `ollama_chat/gpt-oss:120b`** as a heavy reasoning comparison baseline with explicit `edit-format: editor-diff` or `whole` fencing validation.

---

## 2. Four Concrete TangleClaw Aider Harness Gaps Discovered Live (`TangleClaw#2961`)

Running `Medusa-Lane-C (#174)` in production under TangleClaw v5.72.0 surfaced **four reproducible integration defects** (filed upstream as [Jason-Vaughan/TangleClaw#2961](https://github.com/Jason-Vaughan/TangleClaw/issues/2961)):

| Gap # | Component | Observed Symptom in `Medusa-Lane-C` (`#1621` / `#1627`) | Root Cause Verified in Source | Local Workaround Applied & Permanent TangleClaw Fix |
| :--- | :--- | :--- | :--- | :--- |
| **Gap 1** | `.aider.conf.yml` / `lib/aider-task-contract.js` | On first launch (`#1621`), Aider paused for ~35s to run `uv pip install 'aider-chat[playwright]'` and `playwright install chromium`, then tried to scrape `http://localhost:3102;` and `http://localhost:3102:` from the pasted TangleClaw startup prime. | Aider defaults to `detect_urls = True` (`aider/coders/base_coder.py:118`), treating any `http://localhost:3102` string in TangleClaw's prime as a webpage to fetch and scrape. | **Workaround:** Added `detect-urls: false` to `~/.aider.conf.yml`.<br>**TC Fix:** Emit `detect-urls: false` in `lib/aider-task-contract.js` when generating `.aider.conf.yml`. |
| **Gap 2** | `defaultLaunchMode: 'yesAlways'` / `tc start next` ritual | After receiving the pull-pointer prime (`New or unattested launch: tc start next`), `gpt-oss:120b` output `$ tc start next` and sat at `>` without executing it, causing `Medusa-Lane-C` to hit `unreadyWindowMinutes` (`needs-attention`). | In `aider/coders/base_coder.py:2456`, `handle_shell_commands` calls `io.confirm_ask(..., explicit_yes_required=True)`. In `aider/io.py:865`: `if self.yes is True: res = "n" if explicit_yes_required else "y"`. Thus **`--yes-always` silently answers `"n"` to every LLM-suggested shell command**, whereas `/run <cmd>` (`aider/commands.py:1003`) uses `explicit_yes_required=False` and executes cleanly. | **Workaround:** Drove `tc start next` / `tc start ready` / `tc workload set` via `/run` in the Aider pane.<br>**TC Fix:** Mark `aider` as `applicability: 'not-applicable'` for shell-driven `tc start next` (relying on `.tangleclaw/aider-conventions.md` from `#2439`) or drive startup attestation via `/run`. |
| **Gap 3** | `lib/medusa-wake.js` (`ENGINE_WAKE_PROFILES`) | `tc sessions` and `/api/sessions/Medusa-Lane-C/status` report `UNKNOWN, unknown — engine unknown (no-wake-profile)` (`idleReason: "staleness:no-wake-profile:aider"`). Switchboard messages never auto-wake the pane. | `ENGINE_WAKE_PROFILES` in `lib/medusa-wake.js` has entries for `claude`, `codex`, and `antigravity`, but still omits `aider`. | **Workaround:** Injected tasks via tmux `/add` + prompt.<br>**TC Fix:** Add a measured `aider` wake profile (`promptGlyph: '>'`, `promptPattern: '^> ?$'`, `busyMarker: 'Waiting for '`) to `ENGINE_WAKE_PROFILES`. |
| **Gap 4** | `check_for_file_mentions` under `--yes-always` | When `gpt-oss:120b` wrote documentation mentioning `src/medusa/client/MedusaClient.js` and `src/utils/ErrorHandler.js` as examples, Aider auto-added both files to the editable context (`Add file to the chat? [Yes]: y`) and fired an unwanted 18k-token reflection turn. | `check_for_file_mentions` in `aider/coders/base_coder.py` calls `confirm_ask("Add file to the chat?")` with `explicit_yes_required=False`, which `--yes-always` auto-approves for any repo filename appearing in the model's reply. | **Workaround:** Cancelled reflection turn and ran `/drop` on non-envelope files.<br>**TC Fix:** Scope Aider launches to explicit `--file` / `--read` flags from the car's file envelope and suppress automatic file-mention additions. |

---

## 3. Actionable Code Recommendations for `TC-Lane-PM` (`TangleClaw#2961`)

### 3.1 `lib/aider-task-contract.js` — Emit `detect-urls: false` and `suggest-shell-commands: false` in `.aider.conf.yml`
```yaml
# Generated by TangleClaw
read:
  - .tangleclaw/aider-conventions.md
gitignore: false
verbose: false
detect-urls: false
suggest-shell-commands: false
```

### 3.2 `lib/medusa-wake.js` — Register `aider` in `ENGINE_WAKE_PROFILES`
```javascript
aider: {
  busyMarker: 'Waiting for ',
  promptPattern: '^> ?$',
  promptGlyph: '>',
  promptPad: ' ',
  idleMarker: 'Readonly:'
}
```

### 3.3 `lib/launch-sequence.js` / `lib/sessions.js` — Non-Shell Startup Attestation for `aider`
Because Aider is a chat-edit REPL rather than an agentic shell-tool runner (and `aider/io.py:865` hardcodes `res = "n"` for `explicit_yes_required=True` under `--yes-always`), `aider` should either:
1. Declare `supportsLaunchSequence: false` (`applicability: 'not-applicable'`) since `.tangleclaw/aider-conventions.md` is already injected via `read:` in `.aider.conf.yml` (`#2439`), **or**
2. Have `launchKickoff` inject `/run tc start next` so `Commands.cmd_run` executes the CLI directly.

---

## 4. Empirical Summary (`Medusa-Lane-C` Live Telemetry)
- **Startup Scrape Overhead Eliminated:** Setting `detect-urls: false` reduced `Medusa-Lane-C` startup time by **~35 seconds** and eliminated 100% of Playwright loopback errors.
- **Token Usage on `gpt-oss:120b`:** Initial turn consumed `22k sent / 443 received` tokens; documentation generation turn consumed `18k sent / 2.1k received` tokens; unwanted `check_for_file_mentions` reflection turn consumed an additional `18k` prompt tokens before cancellation—proving why compact structured task envelopes (`compact-json-v1`, `typed-cmd-v1`, `tuple-table-v1`, `json-patch-v1`) and strict `--file` scoping are essential for open-weight Aider lanes.
