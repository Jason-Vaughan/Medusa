# 🐍 Medusa Testing Discipline

This file contains binding rules for Gemini CLI sessions in the Medusa workspace. These rules ensure high quality and prevent regressions as we move toward v1.0 Production Readiness.

## 🛡️ The 5-Edit Rule
After every change to `src/a2a_node/**` or `src/medusa/**`, you MUST run the directly-relevant test file before making more than 5 consecutive edits. 
- If you edit `app/core/execution.py`, run `pytest tests/test_execution.py` (or the relevant suite).
- Never allow more than 5 small edits or 1 major refactor to go unverified.

## 🧪 Step/Chunk Completion Protocol
Before declaring any Step (from Phase 4 plan) or Chunk (from Issue/Issue backlog) complete:
1.  Run the FULL test suite for the component you modified.
    - Python: `cd src/a2a_node && export PYTHONPATH=$PYTHONPATH:. && pytest tests/`
    - Node: `cd src/medusa && npm test`
2.  Show the terminal output proving zero failures.
3.  Verification is not complete until both behavioral correctness and structural integrity are confirmed.

## 🏗️ v1.0 Production Standards
- **Network Defaults:** All services MUST bind strictly to `127.0.0.1` by default.
- **HMAC Integrity:** The 5-minute replay window (300s) is non-negotiable.
- **Coverage Floor:** Core modules (`llm.py`, `tangleclaw.py`, `supervisor.py`, `execution.py`) MUST maintain >= 75% coverage.
- **FastAPI Lifecycle:** Use the `lifespan` context manager; do not use deprecated `@app.on_event`.

## 📦 Distribution Policy
- Always run `./scripts/build-distribution.sh` and verify the `.tar.gz` content before declaring Step 4 items done.
- The `INSTALL.sh` must be idempotent and fail-fast.

---
*Follow these rules strictly. They are the mesh's immunity system.* 🧠🐝🛡️
