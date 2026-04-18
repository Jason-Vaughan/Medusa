# Session Memory

## Project: Medusa (A2A Swarm)

### Current State (2026-04-17)
- **OFFICIAL PUBLIC BETA (v0.7.5-beta).**
- **Chunk 22 Complete:** Advanced LLM Decomposition implemented.
- Tasks are now intelligently split using Anthropic/OpenAI with structured JSON responses.
- Sub-tasks include AI-assigned priorities (1-10) for optimized swarm coordination.
- Resilient `LLMService` with multi-provider fallback, retries, and strict timeouts.

### Key Decisions
- **Priority Metadata:** Each sub-task now carries a priority from the LLM, allowing nodes to prioritize foundational work (e.g., research) over dependent work (e.g., coding) more effectively.
- **Strict JSON Prompts:** Medusa-specific prompts ensure sub-tasks are highly relevant and maintain the project's witty personality.

### Open Questions / Future Work
- **Chunk 23: TBD** (Likely focus on Snapshot Pruning or further Mesh Security).
- **Snapshot Pruning:** Implement a janitor task to prune old snapshots (e.g., older than 7 days) to prevent infinite DB growth.

### Resilience
- TangleClaw PortHub integration is working but sometimes times out; gossip protocol handles this by muting errors after the first failure.
- SQLite is used for local ledger; migrations are managed via Alembic.
