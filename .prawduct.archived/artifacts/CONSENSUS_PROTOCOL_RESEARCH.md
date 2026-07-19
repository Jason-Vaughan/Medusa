# Consensus Protocol Research: Multi-Node Task Delegation

**Objective:** Explore voting or multi-node consensus mechanisms for delegating tasks across the BiTCH A2A mesh.

## 🧐 The Problem
In a peer-to-peer AI mesh, multiple nodes might be capable of executing the same task (e.g., "Refactor this function"). We need a way to:
1. **Identify Capable Nodes**: Which nodes have the right tools/context?
2. **Select the Best Node**: Based on load, proximity, or specialized "skills".
3. **Prevent Duplicate Work**: Ensure only one node picks up the task unless redundancy is requested.

## 🛠 Possible Mechanisms

### 1. Auction-Based Delegation (Bidding)
- **Process**:
  1. Requester broadcasts a `TaskAnnouncement`.
  2. Capable nodes respond with a `Bid` (includes cost, estimated time, and "confidence").
  3. Requester selects the best bid and sends a `TaskAssignment`.
- **Pros**: Dynamic, handles heterogeneous nodes well.
- **Cons**: Adds latency (waiting for bids).

### 2. Raft-Lite (Leader Election per Cluster)
- **Process**:
  1. Nodes in a local network elect a "Leader" using a simplified Raft algorithm.
  2. All external tasks are sent to the Leader.
  3. Leader distributes tasks to "Followers" based on a simple round-robin or load-balancing strategy.
- **Pros**: High consistency, single point of coordination.
- **Cons**: Complex to implement, leader failure requires re-election.

### 3. Gossip-Based Work Stealing
- **Process**:
  1. Tasks are added to a "Global Task Pool" (synchronized via Gossip).
  2. Nodes "steal" tasks from the pool by marking them as `claimed` in their local ledger and syncing the change.
  3. Conflict resolution (two nodes claim same task): Prefer the node with the lower `node_id` or earlier `claim_timestamp`.
- **Pros**: Truly decentralized, fits the current Gossip model.
- **Cons**: High risk of race conditions without a shared clock (requires vector clocks or Lamport timestamps).

## 🚀 Recommendation for BiTCH (v0.6.x)
Start with **Auction-Based Bidding** for specific task types and **Gossip-Based Work Stealing** for general background tasks.

### Next Steps for Implementation:
- Add `capabilities` to `PeerEntry` (partially exists).
- Implement a `/a2a/tasks/bid` endpoint.
- Enhance `TaskEntry` status to include `claimed`, `negotiating`, and `finalized`.

---
*🤖 "Consensus is hard. Just do what I say and nobody gets hurt." 🐍*
