# Session Memory

## Project: Medusa (A2A Swarm)

### Current State (2026-07-11)
- **PRODUCTION READINESS (v1.0.0-rc).**
- **Comms Bridge & Queueing:** WebSocket messaging and store-and-forward queueing completed.
- **Fail-Closed Security:** Hardened and verified.
- **Pre-commit Gate:** All Node.js and Python test suites pass 100%.
- **Next Steps:** Implement non-destructive read + delivery ACK (#33) and WS consumer documentation (#34).

### Last Session (2026-07-11)
- **Shipped:** Enforced fail-closed security by removing default `medusa-please` fallbacks, implemented workspaces deregistration (`DELETE /workspaces/:id`), and added WebSocket-disconnect reaping with a lastSeen TTL verification check.
- **Learned:** Dynamic agent connection states require both immediate WebSocket close handlers and passive TTL validation. Open-sourcing code under the MIT license destroys global patent novelty rights unless a provisional application is filed first.
- **Next:** Coordinate with the TangleClaw session to implement non-destructive read + delivery ACK (#33) and document the public WS consumer contract (#34).

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

### Learnings
- Detailed session-by-session technical takeaways are documented in [learnings.md](learnings.md).
