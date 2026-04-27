# Session Memory

## Project: Medusa (A2A Swarm)

### Current State (2026-04-27)
- **OFFICIAL PUBLIC BETA (v0.7.8-beta).**
- **Chunk 25 Complete:** Node Reputation & Dynamic Bidding Thresholds verified.
- **Reputation Engine:** Operational, tracking peer reliability and accuracy.
- **Dynamic Bidding:** Active, adjusting confidence thresholds based on swarm health.
- **Strategic Yield:** Factoring reputation scores to prefer reliable peers.
- **Next: Chunk 26:** Skills Evolution & Automated Task Routing.

### Key Decisions
- **Reputation Scaling:** Decided on +0.1 for completion and -0.5 for stalling (Janitor) to heavily penalize nodes that claim tasks and then fail to deliver.
- **Swarm Health Index:** Using 5-snapshot average of global success rates to stabilize dynamic threshold changes.
- **Signature Payload:** Decided on `timestamp + path` for HMAC payload to ensure simplicity while protecting against replay and path-manipulation attacks.
- **Retention Policy:** Defaulted to 7 days for performance snapshots; configurable via `RETENTION_DAYS`.

### Open Questions / Future Work
- **Node Pruning:** Should we automatically remove peers with reputation < 0.1 after a period of inactivity?
- **Health-Based Bidding:** Factoring resource health (CPU/Load) into the `BiddingHeuristics` to avoid overloading struggling nodes. (Already implemented in Chunk 24, but refining).

### Resilience
- TangleClaw PortHub integration is working but sometimes times out; gossip protocol handles this by muting errors after the first failure.
- SQLite is used for local ledger; migrations are managed via Alembic.
