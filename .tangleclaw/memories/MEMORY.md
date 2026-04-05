# Session Memory

## Project: Medusa (A2A Swarm)

### Current State (2026-04-04)
- **Completed Chunk 17: Collective Strategy Sharing.** 
- Nodes now share their internal heuristics/strategies via the gossip protocol.
- Implemented **Strategic Yield**: Nodes will skip bidding on a task if they detect a peer with a significantly better-matching strategy (higher confidence based on shared skills).
- Database now tracks peer strategies in a JSON field.

### Key Decisions
- **Deterministic Yielding:** To prevent race conditions, the yielding logic is deterministic: if multiple nodes have similar confidence, they use ID-based prioritization as a tie-breaker.
- **Strategy Sync:** Strategies are included in `ping` requests for immediate propagation and merged during periodic `sync` calls.

### Open Questions / Future Work
- **Chunk 18: Performance Metrics Integration:** Next step is to let nodes share their actual performance metrics (latency, success rate) to further refine Strategic Yield.
- **Global Strategy Dashboard:** The dashboard should be updated to visualize the shared strategies of all nodes in the mesh.
- **Dynamic Skill Learning:** Nodes could potentially "learn" which peers are better at specific tasks over time by analyzing consensus results.

### Resilience
- TangleClaw PortHub integration is working but sometimes times out; gossip protocol handles this by muting errors after the first failure.
- SQLite is used for local ledger; migrations are managed via Alembic.
