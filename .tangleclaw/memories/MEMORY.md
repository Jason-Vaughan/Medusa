# Session Memory

## Project: Medusa (A2A Swarm)

### Current State (2026-04-16)
- **OFFICIAL PUBLIC BETA LAUNCH (v0.7.4-beta).**
- **Chunk 21 Complete:** Historical Analytics implemented.
- Time-series snapshots (every 60s) record local and mesh-wide performance (success rate, latency, load).
- Dashboard now features live-updating Chart.js visualizations for long-term swarm health.

### Key Decisions
- **Mesh-Wide Snapshots:** Each node records its own view of the global mesh performance in addition to its local metrics. This provides redundancy and allows for node-specific perspectives on swarm health.
- **60s Resolution:** Settled on a 1-minute resolution for snapshots as a balance between data granularity and DB growth.

### Open Questions / Future Work
- **Chunk 22: Advanced LLM Decomposition:** Replace mock decomposition rules with actual LLM calls (Anthropic/OpenAI).
- **Snapshot Pruning:** Implement a janitor task to prune old snapshots (e.g., older than 7 days) to prevent infinite DB growth.

### Resilience
- TangleClaw PortHub integration is working but sometimes times out; gossip protocol handles this by muting errors after the first failure.
- SQLite is used for local ledger; migrations are managed via Alembic.
