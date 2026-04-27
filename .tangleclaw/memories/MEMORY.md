# Session Memory

## Project: Medusa (A2A Swarm)

### Current State (2026-04-27)
- **OFFICIAL PUBLIC BETA (v0.7.7-beta).**
- **Chunk 24 Complete:** Task Resilience & Global Consensus Refinement verified.
- **Task Janitor:** Operational, recovering stalled tasks via reset-to-pending.
- **Automated Re-vote:** Active with cool-down and HITL escalation for deadlocks.
- **Health-Based Bidding:** Factoring CPU/Mem into heuristics.
- **Next: Chunk 25:** Node Reputation & Dynamic Bidding Thresholds.

### Key Decisions
- **Signature Payload:** Decided on `timestamp + path` for HMAC payload to ensure simplicity while protecting against replay and path-manipulation attacks.
- **Retention Policy:** Defaulted to 7 days for performance snapshots; configurable via `RETENTION_DAYS`.

### Open Questions / Future Work
- **Chunk 24: Task Resilience:** Implement more aggressive "work stealing" for stalled tasks and refine the global consensus voting mechanism.
- **Health-Based Bidding:** Factoring resource health (CPU/Load) into the `BiddingHeuristics` to avoid overloading struggling nodes.

### Resilience
- TangleClaw PortHub integration is working but sometimes times out; gossip protocol handles this by muting errors after the first failure.
- SQLite is used for local ledger; migrations are managed via Alembic.
