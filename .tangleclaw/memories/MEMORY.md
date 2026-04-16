# Session Memory

## Project: Medusa (A2A Swarm)

### Current State (2026-04-16)
- **OFFICIAL PUBLIC BETA LAUNCH (v0.7.3-beta).**
- **Chunk 20 Complete:** Dynamic Load Balancing implemented.
- Nodes now track active load (running/pending) and factor it into bidding, yielding, and decomposition.
- Gossip protocol synchronizes real-time load metrics across the mesh.

### Key Decisions
- **Load-Based Decomposition:** Decided to force decomposition on even simple tasks when load > 3 to encourage parallel execution across peers.
- **Cost-Weighted Bidding:** Load is now a primary factor in `bid_value`, making busy nodes naturally more "expensive" for the swarm to select.

### Open Questions / Future Work
- **Chunk 21: Historical Analytics:** Add time-series graphs for swarm performance over long periods.
- **Load Calibration:** Monitor if the 0.05 confidence penalty per task is too aggressive or too lenient.

### Resilience
- TangleClaw PortHub integration is working but sometimes times out; gossip protocol handles this by muting errors after the first failure.
- SQLite is used for local ledger; migrations are managed via Alembic.
