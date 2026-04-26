# Session Memory

## Project: Medusa (A2A Swarm)

### Current State (2026-04-26)
- **OFFICIAL PUBLIC BETA (v0.7.6-beta).**
- **Chunk 23 Complete:** Mesh Hygiene & Resilience verified and operational.
- **Snapshot Pruning:** Janitor task active (hourly) with 7-day retention.
- **Mesh Health:** Real-time CPU/Mem/Load telemetry integrated into Gossip.
- **Security:** HMAC-SHA256 handshake with timestamp verification active.
- **Next: Chunk 24:** Task Resilience & Global Consensus Refinement.

### Key Decisions
- **Signature Payload:** Decided on `timestamp + path` for HMAC payload to ensure simplicity while protecting against replay and path-manipulation attacks.
- **Retention Policy:** Defaulted to 7 days for performance snapshots; configurable via `RETENTION_DAYS`.

### Open Questions / Future Work
- **Chunk 24: Task Resilience:** Implement more aggressive "work stealing" for stalled tasks and refine the global consensus voting mechanism.
- **Health-Based Bidding:** Factoring resource health (CPU/Load) into the `BiddingHeuristics` to avoid overloading struggling nodes.

### Resilience
- TangleClaw PortHub integration is working but sometimes times out; gossip protocol handles this by muting errors after the first failure.
- SQLite is used for local ledger; migrations are managed via Alembic.
