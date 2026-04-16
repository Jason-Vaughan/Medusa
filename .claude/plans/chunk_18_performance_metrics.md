# Build Plan: Chunk 18 - Swarm Performance Metrics 📊🐝

Nodes will track their own performance (latency, success rate) and share it with the swarm. This data will be used to refine the "Strategic Yield" logic, allowing tasks to be routed not just by claimed skills, but by proven track records.

## Objective
Implement real-world performance tracking and sharing across the A2A mesh to improve task routing efficiency.

## Key Files & Context
- `src/a2a_node/app/models/ledger.py`: `PeerEntry` and `TaskEntry` models.
- `src/a2a_node/app/core/execution.py`: Task execution loop.
- `src/a2a_node/app/core/heuristics.py`: Bidding and yielding logic.
- `src/a2a_node/app/api/gossip.py`: Peer discovery and synchronization.

## Implementation Steps

### 1. Database & Models
- [ ] Add `performance` JSON column to `PeerEntry` in `src/a2a_node/app/models/ledger.py`.
- [ ] Update `LedgerPeer` Pydantic model to include `performance`.
- [ ] Generate and apply an Alembic migration for the new column.

### 2. Performance Tracking Core
- [ ] Create `src/a2a_node/app/core/performance.py` with `PerformanceMonitor` class.
- [ ] Implement local metrics persistence (storing local stats in a dedicated place or a special "local" peer entry).
- [ ] Implement `record_execution(task_type, success, latency)` method.

### 3. Execution Integration
- [ ] Update `src/a2a_node/app/core/execution.py` to:
    - Import `PerformanceMonitor`.
    - Measure `TaskExecutor.execute(task)` time.
    - Record success/failure and latency.

### 4. Gossip & Sharing
- [ ] Update `BiddingHeuristics.share_heuristic()` in `src/a2a_node/app/core/heuristics.py` to include performance metrics.
- [ ] Update `SyncResponse` in `src/a2a_node/app/api/gossip.py` to handle the `performance` field.
- [ ] Update `merge_sync_data` to synchronize the `performance` field from peers.
- [ ] Ensure `ping` also propagates performance data.

### 5. Strategic Yield Refinement
- [ ] Update `BiddingHeuristics.evaluate_with_swarm_intelligence` to:
    - Retrieve peer performance metrics.
    - Calculate a "Performance Multiplier" based on success rate and relative latency.
    - Adjust peer confidence scores using this multiplier.

## Verification & Testing
- [ ] **Unit Test:** Create `src/a2a_node/tests/test_performance.py` to verify metric tracking.
- [ ] **Integration Test:** Verify that performance data is correctly shared via gossip pings/syncs.
- [ ] **Heuristic Test:** Verify that nodes yield more readily to peers with better performance metrics for a given task type.
