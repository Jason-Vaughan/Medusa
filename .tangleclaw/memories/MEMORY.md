# Session Memory

## Project: Medusa (A2A Swarm)

### Current State (2026-04-15)
- **OFFICIAL PUBLIC BETA LAUNCH (v0.7.1-beta).**
- **Chunk 18 Complete:** Swarm Performance Metrics implemented.
- Nodes track success rates and latencies, sharing them via gossip.
- Strategic Yield refined to prioritize reliable, fast peers.

### Key Decisions
- **Deterministic Yielding:** To prevent race conditions, the yielding logic is deterministic: if multiple nodes have similar confidence, they use ID-based prioritization as a tie-breaker.
- **Strategy Sync:** Strategies are included in `ping` requests for immediate propagation and merged during periodic `sync` calls.
- **Performance Multipliers:** Peer confidence is adjusted by success rate (0.7x to 1.2x) and latency (0.9x to 1.1x) to favor reliable nodes.
- **Public Beta Transition:** Decided to move to `0.7.0-beta`+ to signal readiness for external users while maintaining "beta" tag for feedback.

### Open Questions / Future Work
- **Community Feedback Loop:** Establish a process for handling PRs and issues from the public.
- **Chunk 19: Global Strategy Dashboard:** The dashboard should be updated to visualize the shared strategies and performance metrics of all nodes in the mesh.
- **Dynamic Load Balancing:** Further refine yield logic to account for node load (number of active tasks).

### Resilience
- TangleClaw PortHub integration is working but sometimes times out; gossip protocol handles this by muting errors after the first failure.
- SQLite is used for local ledger; migrations are managed via Alembic.
