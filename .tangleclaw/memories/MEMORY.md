# Session Memory

## Project: Medusa (A2A Swarm)

### Current State (2026-04-12)
- **OFFICIAL PUBLIC BETA LAUNCH (v0.7.0-beta).**
- Transitioned repository to Public Beta status.
- Added `CONTRIBUTING.md` and `SECURITY.md`.
- Updated `README.md` and `CHANGELOG.md`.
- Project is now ready for public community involvement.

### Key Decisions
- **Deterministic Yielding:** To prevent race conditions, the yielding logic is deterministic: if multiple nodes have similar confidence, they use ID-based prioritization as a tie-breaker.
- **Strategy Sync:** Strategies are included in `ping` requests for immediate propagation and merged during periodic `sync` calls.
- **Public Beta Transition:** Decided to move to `0.7.0-beta` to signal readiness for external users while maintaining "beta" tag for feedback.

### Open Questions / Future Work
- **Community Feedback Loop:** Establish a process for handling PRs and issues from the public.
- **Chunk 18: Performance Metrics Integration:** Next step is to let nodes share their actual performance metrics (latency, success rate) to further refine Strategic Yield.
- **Global Strategy Dashboard:** The dashboard should be updated to visualize the shared strategies of all nodes in the mesh.

### Resilience
- TangleClaw PortHub integration is working but sometimes times out; gossip protocol handles this by muting errors after the first failure.
- SQLite is used for local ledger; migrations are managed via Alembic.
