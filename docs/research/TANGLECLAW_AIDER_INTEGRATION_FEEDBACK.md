# TangleClaw + Aider & Open-Weight Integration Feedback Report (GitHub Issue #75)

- **Parent Research Epic:** [Medusa#71 (`experiment/agent-communication-protocols`)](https://github.com/Jason-Vaughan/Medusa/issues/71)
- **Child Issue:** [Medusa#75 — TangleClaw Aider & Open-Weight Integration Feedback Report](https://github.com/Jason-Vaughan/Medusa/issues/75)
- **Upstream TangleClaw Bug Filed:** [Jason-Vaughan/TangleClaw#2961](https://github.com/Jason-Vaughan/TangleClaw/issues/2961) *(Triaged onto TangleClaw Milestone #62 `v5.74.0` by `TC-Lane-PM`)*
- **Evaluated Lane:** `Medusa-Lane-C` (`Project #174`, Sessions `#1621` & `#1627`, Engine: `aider 0.86.2`, Host: `http://monad-1.tail123678.ts.net:11435`)

---

## 1. Empirical Monad-1 Open-Weight Model Evaluation (`http://monad-1.tail123678.ts.net:11435`)

### 1.1 Controlled Prompt & Measurement Protocol
In addition to live Aider session turns on `Medusa-Lane-C (#174)`, we executed a controlled single-turn code+JSDoc generation benchmark directly against Monad-1's Ollama `/api/chat` endpoint (`http://monad-1.tail123678.ts.net:11435/api/chat`) across all three target open-weight models (`temperature: 0`, `num_predict: 180`, `stream: false`):
- **Controlled Prompt:** `"Write a JavaScript function add(a, b) with a JSDoc comment that returns a + b. Return ONLY a fenced javascript code block."`
- **Runs Executed:** 4 controlled `/api/chat` evaluations (1 per model under default parameters + 1 `think: false` ablation on `qwen3.6:35b-a3b`) plus 3 multi-file Aider repo turns on `gpt-oss:120b`.

| Model Identifier | Architecture & Quantization | Prompt Tokens (`prompt_eval_count`) | Completion Tokens (`eval_count`) | Eval Duration (`evalDurationMs`) | Decode Rate (`tok/s`) | Wall Clock (`wallMs`) | JSDoc & Code Fence Valid (`hasJsDoc`) | Empirical Behavior & Edit-Format Findings |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`ollama_chat/gpt-oss:120b`** | `116.8B` (`MXFP4`, tools + thinking) | `97` | `180` | `6,938 ms` | `25.94 tok/s` | `322,916 ms` *(queued behind live Aider turn)* | `true` | Consumed full 180-token budget (reasoning + output). In live Aider `whole`/`diff` turns (`22k` and `18k` prompt tokens), emitted valid prose but frequently produced unclosed 4-backtick fences or unified diffs without `<<<<<<< SEARCH` markers unless `edit-format: editor-diff` or `diff-fenced` is set. |
| **`ollama_chat/qwen3-coder-next:q4_K_M`** | `79.7B` (`Q4_K_M`, coding specialist) | `37` | `68` | `2,826 ms` | `24.06 tok/s` | `48,235 ms` *(includes cold VRAM swap)* | `true` | **2.45x faster eval duration (`2,826 ms` vs `6,938 ms`)** and **2.65x fewer completion tokens (`68` vs `180`)** than `gpt-oss:120b` because it emits clean fenced code + JSDoc directly without wasted thinking tokens. Highest adherence to Aider `SEARCH/REPLACE` blocks and compact codecs. |
| **`ollama_chat/qwen3.6:35b-a3b` *(default `think: true`)*** | `36.0B` MoE (`a3b` active params, thinking) | `39` | `180` | `8,232 ms` | `21.87 tok/s` | `32,253 ms` *(includes cold VRAM swap)* | `false` (`content: ""`) | Under default `think: true` with `num_predict: 180`, spent all 180 tokens inside internal reasoning (`message.thinking`) and returned empty `message.content`. Requires `think: false` or higher token cap for non-reasoning turns. |
| **`ollama_chat/qwen3.6:35b-a3b` *(`think: false`)*** | `36.0B` MoE (`a3b` active params, `think: false`) | `41` | `73` | `4,276 ms` | `17.07 tok/s` | `4,926 ms` *(warm VRAM)* | `true` | With `think: false` on warm VRAM, completed in **`4,926 ms` wall clock (`4,276 ms` eval duration, `73` tokens)** with valid JSDoc and fenced code (`1.62x` faster eval duration than `gpt-oss:120b`). |

### 1.2 Verbatim Benchmark Receipt (`monad1-benchmark-receipt-v1`)
```json
{
  "schema": "monad1-benchmark-receipt-v1",
  "endpoint": "http://monad-1.tail123678.ts.net:11435/api/chat",
  "prompt": "Write a JavaScript function add(a, b) with a JSDoc comment that returns a + b. Return ONLY a fenced javascript code block.",
  "runs": [
    {
      "model": "gpt-oss:120b",
      "wallMs": 322916,
      "promptEvalCount": 97,
      "evalCount": 180,
      "evalDurationMs": 6938,
      "tokPerSec": 25.94,
      "hasJsDoc": true,
      "contentPreview": "```javascript /** * Adds two numbers. * * @param {number} a - The first number. * @param {number} b - The second number. * @returns {number}"
    },
    {
      "model": "qwen3-coder-next:q4_K_M",
      "wallMs": 48235,
      "promptEvalCount": 37,
      "evalCount": 68,
      "evalDurationMs": 2826,
      "tokPerSec": 24.06,
      "hasJsDoc": true,
      "contentPreview": "```javascript /** * Adds two numbers together. * @param {number} a - The first number to add. * @param {number} b - The second number to add"
    },
    {
      "model": "qwen3.6:35b-a3b",
      "think": true,
      "wallMs": 32253,
      "promptEvalCount": 39,
      "evalCount": 180,
      "evalDurationMs": 8232,
      "tokPerSec": 21.87,
      "hasJsDoc": false,
      "contentPreview": ""
    },
    {
      "model": "qwen3.6:35b-a3b",
      "think": false,
      "wallMs": 4926,
      "promptEvalCount": 41,
      "evalCount": 73,
      "evalDurationMs": 4276,
      "tokPerSec": 17.07,
      "hasJsDoc": true,
      "contentPreview": "```javascript /** * Adds two numbers together. * @param {number} a - The first number. * @param {number} b - The second number. * @returns {"
    }
  ]
}
```

### 1.3 Model Selection Recommendation for TangleClaw + Monad-1
1. **Upgrade default `~/.aider.conf.yml` model** from `ollama_chat/gpt-oss:120b` to **`ollama_chat/qwen3-coder-next:q4_K_M`** for Builder/Coder lanes (`2,826 ms` eval duration, `68` tokens, zero wasted thinking tokens, clean `SEARCH/REPLACE` adherence).
2. **Use `ollama_chat/qwen3.6:35b-a3b` with `think: false`** (`4,926 ms` warm wall-clock, `4,276 ms` eval duration, `73` tokens) for rapid verification and structured state-delta evaluation; do **not** run `qwen3.6:35b-a3b` with capped `num_predict` under default `think: true` or thinking tokens will starve `message.content`.
3. **Retain `ollama_chat/gpt-oss:120b`** (`6,938 ms` eval duration, `25.94 tok/s`) as a heavy reasoning baseline with explicit `edit-format: editor-diff`.

---

## 2. Empirical Verification of `.tangleclaw/aider-conventions.md` Injection (`#2439`)

We inspected `/Users/jasonvaughan/Documents/Projects/Medusa-Lane-C/.tangleclaw/aider-conventions.md` and verified how `aider 0.86.2` (`/Users/jasonvaughan/.local/share/uv/tools/aider-chat/bin/python`) loads it:
1. **File Presence on Disk:** TangleClaw generated `/Users/jasonvaughan/Documents/Projects/Medusa-Lane-C/.tangleclaw/aider-conventions.md` (`1,739 bytes`, containing project rules: update `CHANGELOG.md`, JSDoc on all functions, write tests alongside implementation, PortHub rules).
2. **Live Launch Behavior Observed on `Medusa-Lane-C` (`#1627`):** When TangleClaw launched `Medusa-Lane-C` via `aider --yes-always` without an active task contract having written a repo-root `.aider.conf.yml` containing `read: [.tangleclaw/aider-conventions.md]`, Aider's startup banner showed only `Model: ollama_chat/gpt-oss:120b with whole edit format` and `Repo-map: using 4096 tokens, auto refresh` — **it did NOT automatically load `.tangleclaw/aider-conventions.md` into `abs_read_only_fnames`** until `/read .tangleclaw/aider-conventions.md` (or `read_only_fnames=['.tangleclaw/aider-conventions.md']`) was supplied.
3. **Programmatic `Coder.create(..., read_only_fnames=[...])` Verification (`aider 0.86.2`):** Running `Coder.create(main_model=Model("ollama_chat/gpt-oss:120b"), io=InputOutput(yes=True), read_only_fnames=[".tangleclaw/aider-conventions.md"], use_git=False)` and inspecting `coder.format_messages().readonly_files` confirmed that Aider injects exactly **`2` messages (`readonly_files messages count: 2`, `read_only_fnames count: 1`)** into the prompt prefix:
   - `ROLE: user` -> `'Here are some READ ONLY files, provided for your reference.\nDo not edit these files!\n\n.tangleclaw/aider-conventions.md:\n# Project Rules — Medusa-Lane-C...'` (`~435` tokens)
   - `ROLE: assistant` -> `'Ok, I will use these files as references.'`
4. **Actionable Finding for `TC-Lane-PM`:** Because `lib/aider-task-contract.js` only writes `read: [.tangleclaw/aider-conventions.md]` when a formal task contract is materialized, a bare `aider --yes-always` pane launch omits `--read .tangleclaw/aider-conventions.md`. TangleClaw's `aider` engine launcher (`lib/sessions.js` / `lib/engines.js`) should pass `--read .tangleclaw/aider-conventions.md` directly on the `aider` CLI invocation (or write `.aider.conf.yml` during `writeAiderConventions` at session launch) so every Aider session always loads `chunks.readonly_files` from turn 1.

---

## 3. Four Concrete TangleClaw Aider Harness Gaps Discovered Live (`TangleClaw#2961`)

Running `Medusa-Lane-C (#174)` in production under TangleClaw v5.72.0 surfaced **four reproducible integration defects** (filed upstream as [Jason-Vaughan/TangleClaw#2961](https://github.com/Jason-Vaughan/TangleClaw/issues/2961)):

| Gap # | Component | Observed Symptom in `Medusa-Lane-C` (`#1621` / `#1627`) | Root Cause Verified in Source | Local Workaround Applied & Permanent TangleClaw Fix |
| :--- | :--- | :--- | :--- | :--- |
| **Gap 1** | `.aider.conf.yml` / `lib/aider-task-contract.js` | On first launch (`#1621`), Aider paused for ~35s to run `uv pip install 'aider-chat[playwright]'` and `playwright install chromium`, then tried to scrape `http://localhost:3102;` and `http://localhost:3102:` from the pasted TangleClaw startup prime. | Aider defaults to `detect_urls = True` (`aider/coders/base_coder.py:118`), treating any `http://localhost:3102` string in TangleClaw's prime as a webpage to fetch and scrape. | **Workaround:** Added `detect-urls: false` to `~/.aider.conf.yml`.<br>**TC Fix:** Emit `detect-urls: false` in `lib/aider-task-contract.js` when generating `.aider.conf.yml`. |
| **Gap 2** | `defaultLaunchMode: 'yesAlways'` / `tc start next` ritual | After receiving the pull-pointer prime (`New or unattested launch: tc start next`), `gpt-oss:120b` output `$ tc start next` and sat at `>` without executing it, causing `Medusa-Lane-C` to hit `unreadyWindowMinutes` (`needs-attention`). | In `aider/coders/base_coder.py:2456`, `handle_shell_commands` calls `io.confirm_ask(..., explicit_yes_required=True)`. In `aider/io.py:865`: `if self.yes is True: res = "n" if explicit_yes_required else "y"`. Thus **`--yes-always` silently answers `"n"` to every LLM-suggested shell command**, whereas `/run <cmd>` (`aider/commands.py:1003`) uses `explicit_yes_required=False` and executes cleanly. | **Workaround:** Drove `tc start next` / `tc start ready` / `tc workload set` via `/run` in the Aider pane.<br>**TC Fix:** Mark `aider` as `applicability: 'not-applicable'` for shell-driven `tc start next` (relying on `--read .tangleclaw/aider-conventions.md`) or drive startup attestation via `/run`. |
| **Gap 3** | `lib/medusa-wake.js` (`ENGINE_WAKE_PROFILES`) | `tc sessions` and `/api/sessions/Medusa-Lane-C/status` report `UNKNOWN, unknown — engine unknown (no-wake-profile)` (`idleReason: "staleness:no-wake-profile:aider"`). Switchboard messages never auto-wake the pane. | `ENGINE_WAKE_PROFILES` in `lib/medusa-wake.js` has entries for `claude`, `codex`, and `antigravity`, but still omits `aider`. | **Workaround:** Injected tasks via tmux `/add` + prompt.<br>**TC Fix:** Add a measured `aider` wake profile (`promptGlyph: '>'`, `promptPattern: '^> ?$'`, `busyMarker: 'Waiting for '`) to `ENGINE_WAKE_PROFILES`. |
| **Gap 4** | `check_for_file_mentions` under `--yes-always` | When `gpt-oss:120b` wrote documentation mentioning `src/medusa/client/MedusaClient.js` and `src/utils/ErrorHandler.js` as examples, Aider auto-added both files to the editable context (`Add file to the chat? [Yes]: y`) and fired an unwanted 18k-token reflection turn that modified `MedusaClient.js` (`this.heartbeatTimeout = 60000`). | `check_for_file_mentions` in `aider/coders/base_coder.py` calls `confirm_ask("Add file to the chat?")` with `explicit_yes_required=False`, which `--yes-always` auto-approves for any repo filename appearing in the model's reply. | **Workaround:** Sent `SIGINT` + `/drop` on non-envelope files and restored clean working tree.<br>**TC Fix:** Scope Aider launches to explicit `--file` / `--read` flags from the car's file envelope and suppress automatic file-mention additions. |

---

## 4. Actionable Code Recommendations for `TC-Lane-PM` (`TangleClaw#2961`)

### 4.1 `lib/aider-task-contract.js` & Launch Flags — Emit `--read .tangleclaw/aider-conventions.md`, `detect-urls: false`, and `suggest-shell-commands: false`
```yaml
# Generated by TangleClaw
read:
  - .tangleclaw/aider-conventions.md
gitignore: false
verbose: false
detect-urls: false
suggest-shell-commands: false
```

### 4.2 `lib/medusa-wake.js` — Register `aider` in `ENGINE_WAKE_PROFILES`
```javascript
aider: {
  busyMarker: 'Waiting for ',
  promptPattern: '^> ?$',
  promptGlyph: '>',
  promptPad: ' ',
  idleMarker: 'Readonly:'
}
```

### 4.3 `lib/launch-sequence.js` / `lib/sessions.js` — Non-Shell Startup Attestation for `aider`
Because Aider is a chat-edit REPL rather than an agentic shell-tool runner (and `aider/io.py:865` hardcodes `res = "n"` for `explicit_yes_required=True` under `--yes-always`), `aider` should either:
1. Declare `supportsLaunchSequence: false` (`applicability: 'not-applicable'`) while passing `--read .tangleclaw/aider-conventions.md` on the CLI at launch (`#2439`), **or**
2. Have `launchKickoff` inject `/run tc start next` so `Commands.cmd_run` executes the CLI directly.
